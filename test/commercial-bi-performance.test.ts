import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Commercial War Room & Gestão — Otimização de Performance (Fase 3)", () => {
  const biViewPath = resolve(__dirname, "../src/components/commercial/CommercialBiView.tsx");
  const biViewCode = readFileSync(biViewPath, "utf-8");

  it("garante que o relógio e a data ao vivo foram isolados no LiveClockHeader memoizado", () => {
    expect(biViewCode).toContain("export const LiveClockHeader = memo(function LiveClockHeader()");
    expect(biViewCode).toContain("<LiveClockHeader />");
    // O estado de relógio deve estar isolado dentro de LiveClockHeader
    expect(biViewCode).toMatch(/function LiveClockHeader\(\)[\s\S]*const \[currentTime, setCurrentTime\] = useState/);
  });

  it("garante que biMemoryCache foi implementado com TTL de 60 segundos", () => {
    expect(biViewCode).toContain("const biMemoryCache = new Map<string, BiDataCacheEntry>();");
    expect(biViewCode).toContain("const BI_CACHE_TTL_MS = 60_000;");
    expect(biViewCode).toContain("biMemoryCache.get(division)");
    expect(biViewCode).toContain("biMemoryCache.set(division,");
  });

  it("garante que o botão Atualizar ignora o cache e força nova requisição", () => {
    expect(biViewCode).toContain("onClick={() => void load(undefined, true)}");
  });

  it("garante que a carga de negociações no CommercialManagementView é lazy (loadDealsIfNeeded)", () => {
    const mgmtPath = resolve(__dirname, "../src/components/commercial/CommercialManagementView.tsx");
    const mgmtCode = readFileSync(mgmtPath, "utf-8");

    expect(mgmtCode).toContain("const loadDealsIfNeeded = useCallback(");
    expect(mgmtCode).toContain("loadDealsIfNeeded();");
    // Não deve chamar getOpenCommercialDeals dentro do load() padrão da aba
    expect(mgmtCode).not.toMatch(/Promise\.all\(\[\s*getJson\("\/api\/commercial\/consultants"\)[^\]]*getOpenCommercialDeals\(\)/s);
  });

  it("garante que todos os componentes de tabela de slide foram memoizados com React.memo", () => {
    const tableFiles = [
      "CommercialPipelineTableView.tsx",
      "CommercialDeparaTableView.tsx",
      "CommercialPrevistasTableView.tsx",
      "CommercialPacingTableView.tsx",
      "CommercialPerdasTableView.tsx",
      "CommercialRankingTableView.tsx",
      "CommercialDiretrizesTableView.tsx",
      "CommercialTmaTableView.tsx",
      "CommercialSafrasTableView.tsx",
      "CommercialConsultantsView.tsx",
      "CommercialProfilesView.tsx",
    ];

    for (const file of tableFiles) {
      const filePath = resolve(__dirname, `../src/components/commercial/${file}`);
      const code = readFileSync(filePath, "utf-8");
      const isMemoized = code.includes("React.memo(") || code.includes("memo(");
      expect(isMemoized).toBeTrue();
    }
  });

  it("garante que isAnimationActive={false} foi adicionado a todos os gráficos Recharts críticos", () => {
    const calendarCode = readFileSync(resolve(__dirname, "../src/components/commercial/CommercialCalendarView.tsx"), "utf-8");
    const analyticsCode = readFileSync(resolve(__dirname, "../src/components/chat/AnalyticsView.tsx"), "utf-8");
    const monitorCode = readFileSync(resolve(__dirname, "../src/components/chat/MonitorView.tsx"), "utf-8");
    const valentinaCode = readFileSync(resolve(__dirname, "../src/components/valentina/chat-blocks/ValentinaBlockRenderer.tsx"), "utf-8");

    // Calendário S-Curve
    expect(calendarCode).toContain('dataKey="expected"');
    expect(calendarCode).toContain("isAnimationActive={false}");

    // AnalyticsView
    expect(analyticsCode).toContain('dataKey="chats"');
    expect(analyticsCode).toContain("isAnimationActive={false}");

    // MonitorView
    expect(monitorCode).toContain('dataKey="score"');
    expect(monitorCode).toContain("isAnimationActive={false}");

    // ValentinaBlockRenderer
    expect(valentinaCode).toContain('dataKey="value"');
    expect(valentinaCode).toContain("isAnimationActive={false}");
  });
});
