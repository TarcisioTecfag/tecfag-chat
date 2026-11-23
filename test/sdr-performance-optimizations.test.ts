import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import zlib from "node:zlib";
import {
  buildSdrJsonResponse,
  computeStableSdrEtag,
} from "../src/routes/api/valentina/sdr";
import {
  computeAdaptiveSdrPollDelayMs,
  mergeSessionsPreservingRefs,
} from "../src/components/valentina/sdr-kanban-data";
import type { SdrTriageSession } from "../src/components/valentina/SdrTab";

const root = resolve(import.meta.dir, "..");
const read = (relPath: string) => readFileSync(resolve(root, relPath), "utf8");

function makeSession(overrides: Partial<SdrTriageSession> = {}): SdrTriageSession {
  return {
    id: "fs-1",
    conversationId: "conv-1",
    contactName: "Maria Silva",
    company: "Industria Exemplo",
    phone: "5514999990001",
    currentStep: "Qualificação",
    collectedData: {
      "NOME COMPLETO": { value: "Maria Silva", status: "filled" },
    },
    startedAt: "2026-11-23T10:00:00.000Z",
    lastClientMessageAt: "2026-11-23T10:05:00.000Z",
    lastMessageAt: "2026-11-23T10:05:00.000Z",
    status: "active",
    outcome: "in_progress",
    responsibleName: "Fagner IA",
    unreadCount: 1,
    channel: "whatsapp",
    triageProgress: {
      filledCount: 1,
      totalCount: 7,
      percentage: 14,
      targetFields: ["NOME COMPLETO"],
    },
    messagesLoaded: false,
    messages: [],
    ...overrides,
  };
}

describe("Otimizações de Performance da Aba SDR (Kanban + Ao Vivo + Internet Lenta)", () => {
  it("buildSdrJsonResponse gera ETag estável, retorna 304 Not Modified (0 bytes) quando If-None-Match bate e comprime gzip > 1KB", async () => {
    const bigSessions = Array.from({ length: 25 }, (_, i) =>
      makeSession({ id: `fs-${i}`, conversationId: `conv-${i}`, contactName: `Cliente ${i}` }),
    );
    const payload1 = {
      config: { enabled: true },
      sessions: bigSessions,
      monitoringSummary: { available: true, generatedAt: "2026-11-23T10:00:00.000Z", byAgent: {} },
    };
    const stableHash1 = {
      ...payload1,
      monitoringSummary: { ...payload1.monitoringSummary, generatedAt: "" },
    };
    const payload2 = {
      ...payload1,
      monitoringSummary: { available: true, generatedAt: "2026-11-23T10:05:00.000Z", byAgent: {} },
    };
    const stableHash2 = {
      ...payload2,
      monitoringSummary: { ...payload2.monitoringSummary, generatedAt: "" },
    };

    expect(computeStableSdrEtag(JSON.stringify(stableHash1))).toBe(
      computeStableSdrEtag(JSON.stringify(stableHash2)),
    );

    const reqGzip = new Request("http://localhost/api/valentina/sdr?includeMessages=0", {
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    });
    const res200 = buildSdrJsonResponse(reqGzip, payload1, stableHash1);
    expect(res200.status).toBe(200);
    expect(res200.headers.get("content-encoding")).toBe("gzip");
    const etag = res200.headers.get("etag");
    expect(etag).toBeTruthy();

    const compressedBuf = Buffer.from(await res200.arrayBuffer());
    const rawBuf = Buffer.from(JSON.stringify(payload1), "utf8");
    expect(compressedBuf.byteLength).toBeLessThan(rawBuf.byteLength * 0.45);
    const decoded = JSON.parse(zlib.gunzipSync(compressedBuf).toString("utf8"));
    expect(decoded.sessions.length).toBe(25);

    const req304 = new Request("http://localhost/api/valentina/sdr?includeMessages=0", {
      headers: {
        "Accept-Encoding": "gzip",
        "If-None-Match": etag!,
      },
    });
    const res304 = buildSdrJsonResponse(req304, payload2, stableHash2);
    expect(res304.status).toBe(304);
    expect((await res304.arrayBuffer()).byteLength).toBe(0);
  });

  it("mergeSessionsPreservingRefs mantém referências exatas de sessões inalteradas e do array inteiro quando nada muda", () => {
    const s1 = makeSession({ id: "fs-1", conversationId: "conv-1" });
    const s2 = makeSession({ id: "fs-2", conversationId: "conv-2", contactName: "João" });
    const prev = [s1, s2];

    const clonedSame = [makeSession({ ...s1 }), makeSession({ ...s2 })];
    const mergedSame = mergeSessionsPreservingRefs(prev, clonedSame);
    expect(mergedSame).toBe(prev);
    expect(mergedSame[0]).toBe(s1);
    expect(mergedSame[1]).toBe(s2);

    const clonedOneChanged = [
      makeSession({ ...s1 }),
      makeSession({ ...s2, status: "awaiting_approval" }),
    ];
    const mergedChanged = mergeSessionsPreservingRefs(prev, clonedOneChanged);
    expect(mergedChanged).not.toBe(prev);
    expect(mergedChanged[0]).toBe(s1);
    expect(mergedChanged[1]).not.toBe(s2);
    expect(mergedChanged[1].status).toBe("awaiting_approval");
  });

  it("computeAdaptiveSdrPollDelayMs adapta intervalo para rede lenta, modo kanban e backoff em erros", () => {
    const fastLive = computeAdaptiveSdrPollDelayMs({ viewMode: "live", effectiveType: "4g", lastRttMs: 250 });
    const fastKanban = computeAdaptiveSdrPollDelayMs({ viewMode: "kanban", effectiveType: "4g", lastRttMs: 250 });
    const slow3g = computeAdaptiveSdrPollDelayMs({ viewMode: "live", effectiveType: "3g", lastRttMs: 400 });
    const highRtt = computeAdaptiveSdrPollDelayMs({ viewMode: "kanban", effectiveType: "4g", lastRttMs: 2000 });
    const saveData = computeAdaptiveSdrPollDelayMs({ viewMode: "live", saveData: true });
    const backoff = computeAdaptiveSdrPollDelayMs({ viewMode: "live", errorStreak: 4 });

    expect(fastKanban).toBeGreaterThan(fastLive);
    expect(slow3g).toBeGreaterThan(fastLive);
    expect(highRtt).toBeGreaterThan(fastKanban);
    expect(saveData).toBeGreaterThan(fastLive);
    expect(backoff).toBeGreaterThan(slow3g);
    expect(backoff).toBeLessThanOrEqual(35000);
  });

  it("elimina loop infinito de re-render em ValentinaView e remove N+1 sequencial do endpoint SDR", () => {
    const valentinaSrc = read("src/components/valentina/ValentinaView.tsx");
    expect(valentinaSrc).not.toContain("onSelectedConversationChange={(conversationId, contactName) =>");
    expect(valentinaSrc).toContain("handleSelectedConversationChange");

    const sdrApiSrc = read("src/routes/api/valentina/sdr.ts");
    expect(sdrApiSrc).toContain("batchLookupKnownClientsByPhoneOrContact");
    expect(sdrApiSrc).toContain('url.searchParams.get("includeMessages")');
    expect(sdrApiSrc).toContain("buildSdrJsonResponse");
    // Apenas 1 chamada remanescente (no POST link_known_client para 1 único contato), nenhuma nos loops do GET
    const singleLookupCalls = sdrApiSrc.match(/await lookupKnownClientByPhoneOrContact\(/g) || [];
    expect(singleLookupCalls.length).toBe(1);
  });

  it("SdrKanbanBoard e SdrTab aplicam memoização, deferred filtering, lazy media e cache SWR sem quebrar Design System", () => {
    const kanbanSrc = read("src/components/valentina/SdrKanbanBoard.tsx");
    expect(kanbanSrc).not.toContain("useChat(");
    expect(kanbanSrc).toContain("React.memo");
    expect(kanbanSrc).toContain('loading="lazy"');
    expect(kanbanSrc).toContain('decoding="async"');
    expect(kanbanSrc).not.toMatch(/\btitle="/);

    const sdrTabSrc = read("src/components/valentina/SdrTab.tsx");
    expect(sdrTabSrc).toContain("useDeferredValue");
    expect(sdrTabSrc).toContain('If-None-Match');
    expect(sdrTabSrc).toContain('includeMessages');
    expect(sdrTabSrc).toContain('preload="metadata"');
    expect(sdrTabSrc).toContain('loading="lazy"');
    expect(sdrTabSrc).toContain("mergeSessionsPreservingRefs");
    expect(sdrTabSrc).toContain("sdr_swr_cache_v1:");
    expect(sdrTabSrc).toContain("SdrKanbanSkeleton");
    expect(sdrTabSrc).toContain("SdrLiveListSkeleton");
    expect(sdrTabSrc).toContain("SdrChatMessagesSkeleton");
    expect(sdrTabSrc).toContain("SdrRightPanelSkeleton");
    expect(sdrTabSrc).toContain("sdr-sync-bar");
    expect(sdrTabSrc).not.toMatch(/\btitle="/);

    const skeletonsSrc = read("src/components/valentina/SdrSkeletons.tsx");
    expect(skeletonsSrc).toContain("sdr-skeleton");
    expect(skeletonsSrc).not.toMatch(/\btitle="/);

    const headerSrc = read("src/components/valentina/SdrHeaderControls.tsx");
    expect(headerSrc).toContain('layoutId="sdr-view-mode-pill"');

    const approvalSrc = read("src/components/valentina/IndustrialApprovalPanel.tsx");
    expect(approvalSrc).toContain("SdrApprovalOptionsSkeleton");

    const stylesSrc = read("src/styles.css");
    expect(stylesSrc).toContain("@keyframes sdr-shimmer-sweep");
    expect(stylesSrc).toContain(".sdr-skeleton");
    expect(stylesSrc).toContain(".sdr-sync-bar");
    expect(stylesSrc).toContain("prefers-reduced-motion: reduce");
  });
});
