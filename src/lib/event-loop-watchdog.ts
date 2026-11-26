import { runtimeSingleton } from "./runtime-singleton";

export interface EventLoopWatchdogOptions {
  /** Intervalo do heartbeat na thread principal (padrão: 1000ms). */
  heartbeatIntervalMs?: number;
  /** Intervalo de checagem na worker thread (padrão: 2000ms). */
  workerPollIntervalMs?: number;
  /** Atraso transitório na thread principal para emitir warning (padrão: 3000ms). */
  warnLagMs?: number;
  /** Tempo sem heartbeat para a worker thread emitir alerta crítico no stderr (padrão: 10000ms). */
  stallAlertMs?: number;
  /** Tempo sem heartbeat para encerrar processo congelado via SIGKILL (padrão: 60000ms; 0 desativa). */
  autoKillMs?: number;
  /** Carência pós-boot antes de alertar/encerrar (padrão: 45000ms). */
  gracePeriodMs?: number;
  /** Permite desativar a worker thread em testes unitários específicos. */
  enableWorkerThread?: boolean;
  /** Logger customizado para testes. */
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface EventLoopWatchdogHandle {
  stop: () => Promise<void>;
  isWorkerActive: () => boolean;
  getSnapshotText: () => string;
}

interface ActiveOpEntry {
  id: number;
  label: string;
  startedAt: number;
}

interface WatchdogGlobalState {
  nextOpId: number;
  activeOps: Map<number, ActiveOpEntry>;
  lastStartedLabel: string;
  lastStartedAt: number;
  sharedBuffer: SharedArrayBuffer | null;
  ctrl: Int32Array | null;
  payload: Uint8Array | null;
  started: boolean;
  handle: EventLoopWatchdogHandle | null;
}

const SHARED_BUFFER_BYTES = 4096;
const CTRL_INT32_COUNT = 4; // [0]=heartbeatMsLow32(sec), [1]=stoppedFlag, [2]=seqLock, [3]=payloadLen
const PAYLOAD_BYTE_OFFSET = CTRL_INT32_COUNT * 4;
const MAX_PAYLOAD_BYTES = SHARED_BUFFER_BYTES - PAYLOAD_BYTE_OFFSET;
const MAX_TRACKED_OPS = 128;
const MAX_SNAPSHOT_OPS = 8;

const textEncoder = new TextEncoder();

function getGlobalState(): WatchdogGlobalState {
  return runtimeSingleton<WatchdogGlobalState>("__valem_eventLoopWatchdogState", () => {
    let sharedBuffer: SharedArrayBuffer | null = null;
    let ctrl: Int32Array | null = null;
    let payload: Uint8Array | null = null;
    try {
      if (typeof SharedArrayBuffer !== "undefined") {
        sharedBuffer = new SharedArrayBuffer(SHARED_BUFFER_BYTES);
        ctrl = new Int32Array(sharedBuffer, 0, CTRL_INT32_COUNT);
        payload = new Uint8Array(sharedBuffer, PAYLOAD_BYTE_OFFSET, MAX_PAYLOAD_BYTES);
      }
    } catch {
      sharedBuffer = null;
      ctrl = null;
      payload = null;
    }

    return {
      nextOpId: 1,
      activeOps: new Map(),
      lastStartedLabel: "none",
      lastStartedAt: 0,
      sharedBuffer,
      ctrl,
      payload,
      started: false,
      handle: null,
    };
  });
}

function sanitizeLabel(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\?.*$/, "")
    .trim()
    .slice(0, 120);
}

export function formatActiveOperationsSnapshot(nowMs = Date.now()): string {
  const state = getGlobalState();
  const entries = Array.from(state.activeOps.values());
  const parts: string[] = [];

  if (entries.length > 0) {
    entries.sort((a, b) => a.startedAt - b.startedAt);
    const slice = entries.slice(0, MAX_SNAPSHOT_OPS);
    for (const op of slice) {
      const ageMs = Math.max(0, nowMs - op.startedAt);
      parts.push(`${op.label} (${ageMs}ms)`);
    }
    if (entries.length > MAX_SNAPSHOT_OPS) {
      parts.push(`+${entries.length - MAX_SNAPSHOT_OPS} mais`);
    }
  } else {
    parts.push("nenhuma operação HTTP/worker ativa");
  }

  const lastAge = state.lastStartedAt > 0 ? `${Math.max(0, nowMs - state.lastStartedAt)}ms atrás` : "n/a";
  return `ativas=[${parts.join(", ")}] | última_iniciada="${state.lastStartedLabel}" (${lastAge})`;
}

function writeSnapshotToSharedMemory(nowMs = Date.now()): void {
  const state = getGlobalState();
  if (!state.ctrl || !state.payload) return;

  const text = formatActiveOperationsSnapshot(nowMs);
  const seq = Atomics.load(state.ctrl, 2);
  Atomics.store(state.ctrl, 2, (seq + 1) | 1); // ímpar = escrita em andamento
  const { written } = textEncoder.encodeInto(text, state.payload);
  Atomics.store(state.ctrl, 3, written);
  Atomics.store(state.ctrl, 2, ((seq + 1) | 1) + 1); // par = snapshot consistente
}

/**
 * Registra uma operação ativa (rota HTTP, webhook, worker) para aparecer no diagnóstico
 * caso o Event Loop sofra lag ou congelamento de CPU.
 */
export function trackEventLoopOperation(rawLabel: string): () => void {
  const label = sanitizeLabel(rawLabel);
  if (!label) return () => {};

  const state = getGlobalState();
  const now = Date.now();
  const id = state.nextOpId++;
  if (state.activeOps.size >= MAX_TRACKED_OPS) {
    const oldestKey = state.activeOps.keys().next().value;
    if (oldestKey !== undefined) state.activeOps.delete(oldestKey);
  }
  state.activeOps.set(id, { id, label, startedAt: now });
  state.lastStartedLabel = label;
  state.lastStartedAt = now;
  writeSnapshotToSharedMemory(now);

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    state.activeOps.delete(id);
    writeSnapshotToSharedMemory(Date.now());
  };
}

/**
 * Verifica se o pathname HTTP deve ser rastreado pelo watchdog (ignora streams longos SSE/WS).
 */
export function shouldTrackHttpPathForWatchdog(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === "/api/events" || pathname.startsWith("/ws/") || pathname === "/api/voice-stream") {
    return false;
  }
  return true;
}

const WATCHDOG_WORKER_SCRIPT = `
const fs = require("node:fs");
const { workerData } = require("node:worker_threads");
const {
  sharedBuffer,
  parentPid,
  pollIntervalMs,
  stallAlertMs,
  autoKillMs,
  gracePeriodMs,
} = workerData;

const ctrl = new Int32Array(sharedBuffer, 0, 4);
const payload = new Uint8Array(sharedBuffer, 16);
const decoder = new TextDecoder();
const startedAtMs = Date.now();
let lastAlertAtMs = 0;

function writeStderrDirect(line) {
  try {
    fs.writeSync(2, line);
  } catch {
    try {
      process.stderr.write(line);
    } catch {}
  }
}

function readSnapshot() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const seq1 = Atomics.load(ctrl, 2);
    if ((seq1 & 1) === 1) continue;
    const len = Math.max(0, Math.min(payload.byteLength, Atomics.load(ctrl, 3)));
    const copy = new Uint8Array(len);
    copy.set(payload.subarray(0, len));
    const seq2 = Atomics.load(ctrl, 2);
    if (seq1 === seq2) {
      return decoder.decode(copy);
    }
  }
  return "snapshot em atualização";
}

const timer = setInterval(() => {
  if (Atomics.load(ctrl, 1) === 1) {
    clearInterval(timer);
    return;
  }
  const nowMs = Date.now();
  if (nowMs - startedAtMs < gracePeriodMs) return;

  const lastHeartbeatSec = Atomics.load(ctrl, 0);
  if (!lastHeartbeatSec) return;

  const stalledMs = nowMs - lastHeartbeatSec * 1000;
  if (stalledMs < stallAlertMs) {
    lastAlertAtMs = 0;
    return;
  }

  const snapshot = readSnapshot();
  if (nowMs - lastAlertAtMs >= stallAlertMs) {
    lastAlertAtMs = nowMs;
    const stalledSec = (stalledMs / 1000).toFixed(1);
    writeStderrDirect(
      \`[EventLoopWatchdog] 🔴 EVENT LOOP TRAVADO há \${stalledSec}s (pid=\${parentPid})! Operações no instante do travamento: \${snapshot}\\n\`
    );
  }

  if (autoKillMs > 0 && stalledMs >= autoKillMs) {
    const stalledSec = (stalledMs / 1000).toFixed(1);
    writeStderrDirect(
      \`[EventLoopWatchdog] 💀 EVENT LOOP CONGELADO há \${stalledSec}s (>= \${Math.round(autoKillMs / 1000)}s). Encerrando processo (SIGKILL) para auto-recuperação pelo Railway! Operações: \${snapshot}\\n\`
    );
    clearInterval(timer);
    try {
      process.kill(parentPid, "SIGKILL");
    } catch {
      process.exit(1);
    }
  }
}, pollIntervalMs);
`;

export function parseAutoKillMsFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.EVENT_LOOP_WATCHDOG_AUTOKILL_MS;
  if (raw === undefined || raw === "") return 60_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 60_000;
  if (parsed === 0) return 0;
  // Nunca permitir auto-kill agressivo demais (< 15s)
  return Math.max(15_000, Math.floor(parsed));
}

export function startEventLoopWatchdog(options: EventLoopWatchdogOptions = {}): EventLoopWatchdogHandle {
  const state = getGlobalState();
  if (state.started && state.handle) {
    return state.handle;
  }

  const heartbeatIntervalMs = Math.max(100, options.heartbeatIntervalMs ?? 1_000);
  const workerPollIntervalMs = Math.max(100, options.workerPollIntervalMs ?? 2_000);
  const warnLagMs = Math.max(200, options.warnLagMs ?? 3_000);
  const stallAlertMs = Math.max(500, options.stallAlertMs ?? 10_000);
  const autoKillMs = options.autoKillMs !== undefined ? options.autoKillMs : parseAutoKillMsFromEnv();
  const gracePeriodMs = Math.max(0, options.gracePeriodMs ?? 45_000);
  const enableWorkerThread =
    options.enableWorkerThread ?? typeof (globalThis as Record<string, unknown>).Bun === "undefined";
  const logger = options.logger ?? console;

  const now = Date.now();
  if (state.ctrl) {
    Atomics.store(state.ctrl, 0, Math.floor(now / 1000));
    Atomics.store(state.ctrl, 1, 0);
  }
  writeSnapshotToSharedMemory(now);

  let lastTickMs = now;
  let stopped = false;

  const heartbeatTimer = setInterval(() => {
    if (stopped) return;
    const tickNow = Date.now();
    const lagMs = tickNow - lastTickMs - heartbeatIntervalMs;
    lastTickMs = tickNow;

    if (state.ctrl) {
      Atomics.store(state.ctrl, 0, Math.floor(tickNow / 1000));
    }
    writeSnapshotToSharedMemory(tickNow);

    if (lagMs >= warnLagMs) {
      const mem = process.memoryUsage();
      const rssMb = (mem.rss / 1024 / 1024).toFixed(0);
      const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(0);
      logger.warn(
        `[EventLoopWatchdog] ⚠️ Event loop atrasou ${lagMs}ms (rss=${rssMb}MB heap=${heapMb}MB) | ${formatActiveOperationsSnapshot(tickNow)}`,
      );
    }
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();

  let workerInstance: { terminate: () => Promise<number>; unref?: () => void } | null = null;
  let workerActive = false;

  if (enableWorkerThread && state.sharedBuffer) {
    void (async () => {
      try {
        const { Worker } = await import("node:worker_threads");
        if (stopped || !state.sharedBuffer) return;
        const worker = new Worker(WATCHDOG_WORKER_SCRIPT, {
          eval: true,
          workerData: {
            sharedBuffer: state.sharedBuffer,
            parentPid: process.pid,
            pollIntervalMs: workerPollIntervalMs,
            stallAlertMs,
            autoKillMs,
            gracePeriodMs,
          },
        });
        worker.unref();
        worker.on("error", (err) => {
          workerActive = false;
          logger.warn(
            `[EventLoopWatchdog] Worker de monitoramento encerrado com aviso: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
        worker.on("exit", () => {
          workerActive = false;
        });
        workerInstance = worker;
        workerActive = true;
        logger.log(
          `[EventLoopWatchdog] 🛡️ Monitor ativo (warn>=${warnLagMs}ms, stall>=${stallAlertMs}ms, autoKill=${autoKillMs > 0 ? `${autoKillMs}ms` : "desativado"}, grace=${gracePeriodMs}ms).`,
        );
      } catch (err) {
        workerActive = false;
        logger.warn(
          `[EventLoopWatchdog] Worker thread indisponível; operando apenas com detector na thread principal (${err instanceof Error ? err.message : String(err)}).`,
        );
      }
    })();
  } else {
    logger.log(
      `[EventLoopWatchdog] 🛡️ Monitor ativo na thread principal (warn>=${warnLagMs}ms).`,
    );
  }

  const handle: EventLoopWatchdogHandle = {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(heartbeatTimer);
      if (state.ctrl) {
        Atomics.store(state.ctrl, 1, 1);
      }
      if (workerInstance) {
        try {
          await workerInstance.terminate();
        } catch {
          // ignore termination error on shutdown
        }
        workerInstance = null;
        workerActive = false;
      }
      state.started = false;
      state.handle = null;
    },
    isWorkerActive: () => workerActive,
    getSnapshotText: () => formatActiveOperationsSnapshot(Date.now()),
  };

  state.started = true;
  state.handle = handle;
  return handle;
}
