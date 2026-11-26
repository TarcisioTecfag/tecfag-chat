import { describe, expect, it } from "bun:test";
import {
  formatActiveOperationsSnapshot,
  parseAutoKillMsFromEnv,
  shouldTrackHttpPathForWatchdog,
  startEventLoopWatchdog,
  trackEventLoopOperation,
} from "../src/lib/event-loop-watchdog";

describe("EventLoopWatchdog — rastreamento de operações e detecção de travamento", () => {
  it("rastreia operações ativas, remove querystring sensível e ignora streams SSE/WS", () => {
    expect(shouldTrackHttpPathForWatchdog("/api/chats")).toBe(true);
    expect(shouldTrackHttpPathForWatchdog("/api/webhooks/meta")).toBe(true);
    expect(shouldTrackHttpPathForWatchdog("/api/events")).toBe(false);
    expect(shouldTrackHttpPathForWatchdog("/ws/livechat")).toBe(false);
    expect(shouldTrackHttpPathForWatchdog("/api/voice-stream")).toBe(false);

    const endOp = trackEventLoopOperation("POST /api/webhooks/meta?token=secret123");
    try {
      const snapActive = formatActiveOperationsSnapshot();
      expect(snapActive).toContain("POST /api/webhooks/meta");
      expect(snapActive).not.toContain("secret123");
    } finally {
      endOp();
      endOp(); // idempotente
    }

    const snapAfter = formatActiveOperationsSnapshot();
    expect(snapAfter).toContain('última_iniciada="POST /api/webhooks/meta"');
    expect(snapAfter).not.toContain("POST /api/webhooks/meta (");
  });

  it("valida limites seguros de EVENT_LOOP_WATCHDOG_AUTOKILL_MS", () => {
    expect(parseAutoKillMsFromEnv({})).toBe(60_000);
    expect(parseAutoKillMsFromEnv({ EVENT_LOOP_WATCHDOG_AUTOKILL_MS: "0" })).toBe(0);
    expect(parseAutoKillMsFromEnv({ EVENT_LOOP_WATCHDOG_AUTOKILL_MS: "5000" })).toBe(15_000);
    expect(parseAutoKillMsFromEnv({ EVENT_LOOP_WATCHDOG_AUTOKILL_MS: "90000" })).toBe(90_000);
    expect(parseAutoKillMsFromEnv({ EVENT_LOOP_WATCHDOG_AUTOKILL_MS: "invalid" })).toBe(60_000);
  });

  it("detecta atraso síncrono do Event Loop e registra operação ativa no warning", async () => {
    const warnings: string[] = [];
    const logs: string[] = [];
    const handle = startEventLoopWatchdog({
      heartbeatIntervalMs: 100,
      warnLagMs: 200,
      autoKillMs: 0,
      gracePeriodMs: 0,
      enableWorkerThread: false,
      logger: {
        log: (m) => logs.push(m),
        warn: (m) => warnings.push(m),
        error: (m) => warnings.push(m),
      },
    });

    try {
      const endTrack = trackEventLoopOperation("inbound:meta:tecfag");
      // Simula travamento síncrono curto (~360ms) na thread principal
      const blockUntil = Date.now() + 360;
      while (Date.now() < blockUntil) {
        // busy spin proposital para teste
      }
      // Aguarda próximo tick do timer de 100ms
      await new Promise((r) => setTimeout(r, 150));
      endTrack();

      expect(warnings.some((w) => w.includes("Event loop atrasou") && w.includes("inbound:meta:tecfag"))).toBe(
        true,
      );
    } finally {
      await handle.stop();
    }
  });

  it("inicializa e encerra watchdog de forma limpa e idempotente (sem travar shutdown)", async () => {
    const logs: string[] = [];
    const handle = startEventLoopWatchdog({
      heartbeatIntervalMs: 100,
      workerPollIntervalMs: 100,
      stallAlertMs: 5_000,
      autoKillMs: 0,
      gracePeriodMs: 5_000,
      enableWorkerThread: false,
      logger: {
        log: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(logs.some((m) => m.includes("[EventLoopWatchdog]"))).toBe(true);
    await handle.stop();
    await handle.stop(); // idempotente
    expect(handle.isWorkerActive()).toBe(false);
  });
});
