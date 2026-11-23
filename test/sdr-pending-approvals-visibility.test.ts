import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { mergeLatestAndPrioritySdrFlows } from "../src/lib/triage/agent-monitor-store";

describe("Visibilidade garantida de aprovações pendentes no Painel SDR (readLatestSdrFlows)", () => {
  it("preserva 100% das 10 aprovações pendentes mesmo quando 100+ disparos proativos mais recentes ocupam o topo", () => {
    const recentProactive = Array.from({ length: 100 }, (_, i) => ({
      id: `fs-proactive-${i}`,
      conversationId: `conv-proactive-${i}`,
      lastInteractionAt: new Date(Date.parse("2026-11-23T17:35:00.000Z") - i * 1000),
    }));

    // Simula Tailís (18:56) e Taffarel (18:51) já nos recentes + 8 aprovações mais antigas (15:15–17:31)
    recentProactive[0] = {
      id: "fs-tailis",
      conversationId: "conv-tailis",
      lastInteractionAt: new Date("2026-11-23T18:56:08.058Z"),
    };
    recentProactive[1] = {
      id: "fs-taffarel",
      conversationId: "conv-taffarel",
      lastInteractionAt: new Date("2026-11-23T18:51:50.471Z"),
    };

    const priorityApprovals = [
      { id: "fs-tailis", conversationId: "conv-tailis", lastInteractionAt: new Date("2026-11-23T18:56:08.058Z") },
      { id: "fs-taffarel", conversationId: "conv-taffarel", lastInteractionAt: new Date("2026-11-23T18:51:50.471Z") },
      { id: "fs-jose", conversationId: "conv-jose", lastInteractionAt: new Date("2026-11-23T17:31:10.653Z") },
      { id: "fs-abimael", conversationId: "conv-abimael", lastInteractionAt: new Date("2026-11-23T17:30:50.835Z") },
      { id: "fs-jeovanei", conversationId: "conv-jeovanei", lastInteractionAt: new Date("2026-11-23T17:29:13.999Z") },
      { id: "fs-urani", conversationId: "conv-urani", lastInteractionAt: new Date("2026-11-23T17:29:02.899Z") },
      { id: "fs-felipe", conversationId: "conv-felipe", lastInteractionAt: new Date("2026-11-23T16:38:09.809Z") },
      { id: "fs-ricardo", conversationId: "conv-ricardo", lastInteractionAt: new Date("2026-11-23T15:59:09.491Z") },
      { id: "fs-anatiele", conversationId: "conv-anatiele", lastInteractionAt: new Date("2026-11-23T15:52:39.476Z") },
      { id: "fs-kassia", conversationId: "conv-kassia", lastInteractionAt: new Date("2026-11-23T15:15:16.113Z") },
    ];

    const merged = mergeLatestAndPrioritySdrFlows(recentProactive, priorityApprovals);

    // 100 recentes + 8 aprovações que tinham sido empurradas para fora = 108 únicas (sem duplicar Tailís/Taffarel)
    expect(merged).toHaveLength(108);
    const convIds = new Set(merged.map((r) => r.conversationId));
    for (const p of priorityApprovals) {
      expect(convIds.has(p.conversationId)).toBe(true);
    }
    // Ordenação decrescente preservada
    expect(merged[0].conversationId).toBe("conv-tailis");
    expect(merged[merged.length - 1].conversationId).toBe("conv-kassia");
  });

  it("agent-monitor-store.ts consulta aprovações pendentes isoladas por tenantId + queueState='automacao' + operatorId IS NULL", () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/triage/agent-monitor-store.ts"),
      "utf8",
    );
    expect(src).toContain("eq(conversations.tenantId, tenantId)");
    expect(src).toContain('eq(conversations.queueState, "automacao")');
    expect(src).toContain("isNull(conversations.operatorId)");
    expect(src).toContain("'awaiting_approval'");
    expect(src).toContain("mergeLatestAndPrioritySdrFlows");
  });
});
