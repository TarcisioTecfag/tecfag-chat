import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  formatActiveOperationsSnapshot,
  parseAutoKillMsFromEnv,
  shouldTrackHttpPathForWatchdog,
  startEventLoopWatchdog,
  trackEventLoopOperation,
} from "../src/lib/event-loop-watchdog";
import {
  extractAlphanumericModelCandidates,
  extractPhotoModelMetadata,
  searchIndustrialCatalogEntries,
} from "../src/lib/valentina/knowledge-service";
import { deriveVtexQuery } from "../src/lib/vtex/turn";
import { isCasualConversationQuery } from "../src/lib/valentina/agentic-thought-trace";

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

  it("garante que railway.json não usa 'exec node' (evita PID 1 imune a SIGKILL no Linux)", () => {
    const railwayJsonPath = path.resolve(process.cwd(), "railway.json");
    const parsed = JSON.parse(fs.readFileSync(railwayJsonPath, "utf8"));
    const startCmd = String(parsed?.deploy?.startCommand || "");
    expect(startCmd).toContain("node .output/server/index.mjs");
    expect(startCmd).not.toMatch(/\bexec\s+node\b/);
  });
});

describe("Blindagem anti-ReDoS — regressão do congelamento em URLs/tokens longos (incidente 26/11)", () => {
  const TRIHAIR_URL =
    "https://www.mercadolivre.com.br/suporte-fixo-do-rolo-de-fita-adesiva--fxjasfx/up/MLBU754188807?matt_tool=38524122&pdp_filters=item_id%3AMLB3025037033&ua=WREz3SztFG6taxw5vx5101_OFY1EgvZUpQeHc8D1tWB_-g";

  it("extractAlphanumericModelCandidates processa URL real da Trihair e tokens adversariais em tempo linear (< 25ms)", () => {
    const normUrl = TRIHAIR_URL.toLowerCase();
    const adversarial = `${"wrez3sztfg6taxw5vx5101_ofy1egvzupqehc8d1twb".repeat(4)}_-g`;

    const t0 = performance.now();
    extractAlphanumericModelCandidates(normUrl);
    extractAlphanumericModelCandidates(normUrl, { allowSlash: true });
    extractAlphanumericModelCandidates(adversarial);
    extractAlphanumericModelCandidates(adversarial, { allowSlash: true });
    const elapsedMs = performance.now() - t0;

    expect(elapsedMs).toBeLessThan(25);
  });

  it("extractAlphanumericModelCandidates continua reconhecendo códigos reais de máquinas Tecfag", () => {
    const samples = [
      "apf300-2b",
      "apf 300",
      "bsf-5640lg",
      "dz400",
      "vsf-30s",
      "vsf 30agiii",
      "frb-770i",
      "tc-20",
      "hzk-160",
      "bs-6535la",
      "fzl-200s",
      "kfg-500",
    ];
    for (const code of samples) {
      expect(extractAlphanumericModelCandidates(`quero saber sobre ${code} urgente`)).toContain(code);
    }
    expect(extractAlphanumericModelCandidates("modelo apf300/2b", { allowSlash: true })).toContain(
      "apf300/2b",
    );
  });

  it("searchIndustrialCatalogEntries e extractPhotoModelMetadata resistem à URL da Trihair sem travar CPU", () => {
    const fullHistory = [
      "[ID MENSAGEM: msg_in_d105e56d655b267e4e1e00faffe8376f9c8026e0e82f7d03abf9b1bcf1ed9f09] [Cliente]: Bom dia, tudo bem?",
      `[ID MENSAGEM: msg_in_0c08c7c9ccede75d8e478c0120fb272a1685316ec73e55f748901af037b514d8] [Cliente]: ${TRIHAIR_URL}`,
      "[ID MENSAGEM: msg_in_1940c93d215aa66e3b5282cc3eeb41f74b47e9dcdfe477e14241c1bbb762cd64] [Cliente]: Estou com essa compra para realizar, gostaria de mais informações quanto ao frete.",
    ].join("\n");

    // Aquece o mapa pré-extraído de manuais (gunzip único no processo) antes de medir o tempo da consulta
    searchIndustrialCatalogEntries("seladora");

    const t0 = performance.now();
    const res = searchIndustrialCatalogEntries(fullHistory);
    const meta = extractPhotoModelMetadata("WREZ3SZTFG6TAXW5VX5101_OFY1EGVZUPQEHC8D1TWB_!");
    const elapsedMs = performance.now() - t0;

    expect(typeof res).toBe("string");
    expect(meta.displayName.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(350);
  });

  it("deriveVtexQuery processa demonstrativos repetidos sem backtracking exponencial e mantém classificação correta", () => {
    const adversarial = `qual o preco de ${"essa ".repeat(50)}${"acima ".repeat(30)}x`;
    const t0 = performance.now();
    const advResult = deriveVtexQuery(adversarial, null);
    const elapsedMs = performance.now() - t0;

    expect(elapsedMs).toBeLessThan(30);
    expect(advResult?.intent).toBe("price");

    // Referências genéricas não viram busca de termo na loja
    expect(deriveVtexQuery("qual o preco dessa maquina acima?", null)?.query).toBeNull();
    expect(deriveVtexQuery("qual o preco dessa acima?", null)?.query).toBeNull();
    expect(deriveVtexQuery("qual o preco acima?", null)?.query).toBeNull();
    // Produto real nomeado continua gerando termo
    expect(deriveVtexQuery("qual o preco da seladora bsf-5640lg?", null)?.query).toEqual({
      kind: "term",
      value: "seladora bsf-5640lg",
      quantity: 1,
    });
  });

  it("isCasualConversationQuery processa entradas repetitivas coladas em tempo linear", () => {
    const t0 = performance.now();
    const res = isCasualConversationQuery(`${"oi".repeat(30)}x`);
    const elapsedMs = performance.now() - t0;

    expect(res).toBe(false);
    expect(elapsedMs).toBeLessThan(20);
    expect(isCasualConversationQuery("bom dia tudo bem")).toBe(true);
    expect(isCasualConversationQuery("oi fagner")).toBe(true);
  });

  it("garante ausência do padrão regex vulnerável (?:[-_\\s/]?[a-z0-9]{1,5})* nos serviços críticos", () => {
    const filesToCheck = [
      "src/lib/valentina/knowledge-service.ts",
      "src/lib/valentina/vtex-assistant-service.ts",
      "src/routes/api/valentina/catalog-images.ts",
    ];
    for (const rel of filesToCheck) {
      const content = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      expect(content).not.toMatch(/\(\?:\\?\[-_\\s\/\.?\]\?\[[a-zA-Z0-9-]+\]\{1,5\}\)\*/);
    }
  });
});
