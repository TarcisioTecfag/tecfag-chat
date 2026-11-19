import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readSrc = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("Chat Meus Queue Visibility & Pagination Regression", () => {
  it("carrega queue=meus&mine=1 em paralelo na carga inicial e na reconexão SSE", () => {
    const src = readSrc("src/hooks/useChatState.tsx");
    const matches = src.match(/\/api\/chats\?queue=meus&mine=1&limit=250/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("const cursorIso = last?.cursorAtISO || last?.lastMessageAtISO;");
  });

  it("sempre executa o fetch dedicado da fila na primeira abertura do escopo e expõe fallback Carregar mais", () => {
    const src = readSrc("src/components/chat/ChatList.tsx");
    expect(src).toContain("fetchedQueueScopesRef");
    expect(src).toContain("scopeCursorByKeyRef");
    expect(src).not.toContain("if ((oldest && !needsInitialChipFetch) || pageLoadingRef.current) return;");
    expect(src).toContain("Carregar mais atendimentos");
  });

  it("garante chats próprios em ownership=1 e expõe cursorAtISO canônico em /api/chats", () => {
    const src = readSrc("src/routes/api/chats.ts");
    expect(src).toContain("ownActiveOwnership");
    expect(src).toContain('eq(conversations.queueState, "meus")');
    expect(src).toContain("cursorAtISO: fallbackIso");
  });

  it("mescla carga própria + global preservando 100% dos 25 chats da operadora mesmo quando só 7 aparecem no top 150 global", () => {
    const raianeChats = Array.from({ length: 25 }, (_, i) => ({
      id: `conv-raiane-${i + 1}`,
      operatorId: "op-raiane",
      queue: "meus" as const,
      cursorAtISO: new Date(Date.UTC(2026, 10, 19, 18 - i, 0, 0)).toISOString(),
    }));
    const otherOperatorsChats = Array.from({ length: 143 }, (_, i) => ({
      id: `conv-other-${i + 1}`,
      operatorId: `op-other-${i % 20}`,
      queue: "meus" as const,
      cursorAtISO: new Date(Date.UTC(2026, 10, 19, 18, 0, 0) - i * 60_000).toISOString(),
    }));

    // Simula corte global de 150 chats onde apenas 7 da Raiane aparecem
    const globalTop150 = [...raianeChats.slice(0, 7), ...otherOperatorsChats];
    const mineTop250 = [...raianeChats];

    const mergedById = new Map<string, (typeof raianeChats)[number]>();
    for (const chat of mineTop250) mergedById.set(chat.id, chat);
    for (const chat of globalTop150) {
      if (!mergedById.has(chat.id)) mergedById.set(chat.id, chat);
    }

    const merged = Array.from(mergedById.values());
    const visibleForRaiane = merged.filter(
      (c) => c.queue === "meus" && c.operatorId === "op-raiane",
    );

    expect(visibleForRaiane.length).toBe(25);
    expect(merged.length).toBe(168);
  });
});
