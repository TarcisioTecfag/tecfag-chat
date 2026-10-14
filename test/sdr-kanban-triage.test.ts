// ══════════════════════════════════════════════════════════════════════════════
// 🧪 TESTES UNITÁRIOS — KANBAN DE TRIAGEM SDR (FAGNER / VALENTINA)
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from "bun:test";
import {
  KANBAN_COLUMNS,
  classifySessionToColumn,
  BENCHMARK_SDR_SESSIONS,
  KanbanColumnKey,
  computeOffscreenKanbanIndicators,
  getColumnScrollTarget,
  OffscreenColumnMetric,
} from "../src/components/valentina/sdr-kanban-data";
import { getAiPersona } from "../src/lib/ai-persona";

describe("SDR Kanban Board — Funis de Triagem", () => {
  it("deve conter exatamente as 9 colunas de funil na ordem especificada (sem avulso e problemas)", () => {
    const expectedKeys: KanbanColumnKey[] = [
      "triagem",
      "assistencia_tecnica",
      "pos_venda",
      "maquinas",
      "personalite",
      "financeiro",
      "pecas",
      "outros",
      "sem_resposta",
    ];

    expect(KANBAN_COLUMNS.length).toBe(9);
    expect(KANBAN_COLUMNS.map((c) => c.key)).toEqual(expectedKeys);
    expect(KANBAN_COLUMNS.map((c) => c.key)).not.toContain("avulso");
    expect(KANBAN_COLUMNS.map((c) => c.key)).not.toContain("problemas");
  });

  it("deve possuir os rótulos em caixa alta das 9 etapas ativas", () => {
    const labels = KANBAN_COLUMNS.map((c) => c.label);
    expect(labels).toContain("TRIAGEM");
    expect(labels).toContain("ASSISTÊNCIA TÉCNICA");
    expect(labels).toContain("PÓS VENDA");
    expect(labels).toContain("MÁQUINAS");
    expect(labels).toContain("PERSONNALITÉ");
    expect(labels).toContain("FINANCEIRO");
    expect(labels).toContain("PEÇAS");
    expect(labels).toContain("OUTROS");
    expect(labels).toContain("SEM RESPOSTA");
    expect(labels).not.toContain("AVULSO");
    expect(labels).not.toContain("PROBLEMAS");
  });

  it("deve classificar sessões abandonadas ou sem resposta na coluna sem_resposta", () => {
    const sessionAbandoned = {
      id: "test-1",
      conversationId: "conv-1",
      contactName: "Cliente 1",
      company: "Empresa 1",
      phone: "11999999999",
      currentStep: "Qualificação",
      collectedData: {},
      startedAt: new Date().toISOString(),
      status: "abandoned" as const,
      messages: [],
    };
    expect(classifySessionToColumn(sessionAbandoned)).toBe("sem_resposta");

    const sessionNoReply = {
      id: "test-2",
      conversationId: "conv-2",
      contactName: "Cliente 2",
      company: "Empresa 2",
      phone: "11999999999",
      currentStep: "Aguardando",
      collectedData: {},
      startedAt: new Date().toISOString(),
      status: "active" as const,
      outcome: "sem_resposta",
      messages: [],
    };
    expect(classifySessionToColumn(sessionNoReply)).toBe("sem_resposta");
  });

  it("deve redirecionar sessões legadas de problemas ou avulso com segurança para outros", () => {
    const sessionProblem = {
      id: "test-3",
      conversationId: "conv-3",
      contactName: "Cliente 3",
      company: "Empresa 3",
      phone: "11999999999",
      currentStep: "Problema com voltagem 110V",
      collectedData: {},
      startedAt: new Date().toISOString(),
      status: "active" as const,
      outcome: "problem",
      messages: [],
    };
    expect(classifySessionToColumn(sessionProblem)).toBe("outros");

    const sessionLegacyFunnelStage = {
      ...sessionProblem,
      id: "test-3b",
      funnelStage: "avulso",
    } as any;
    expect(classifySessionToColumn(sessionLegacyFunnelStage)).toBe("outros");
  });

  it("deve classificar setores específicos (máquinas, peças, assistência, personnalite, financeiro)", () => {
    const sessionPecas = {
      id: "test-4",
      conversationId: "conv-4",
      contactName: "Cliente Peças",
      company: "Empresa Peças",
      phone: "11999999999",
      currentStep: "Peças",
      collectedData: {
        "QUAL O TIPO DE PRODUTO?": { value: "Peças de reposição", status: "filled" as const },
      },
      startedAt: new Date().toISOString(),
      status: "active" as const,
      messages: [],
    };
    expect(classifySessionToColumn(sessionPecas)).toBe("pecas");

    const sessionMaquinas = {
      id: "test-5",
      conversationId: "conv-5",
      contactName: "Cliente Máquinas",
      company: "Empresa Máquinas",
      phone: "11999999999",
      currentStep: "Máquinas",
      collectedData: {
        "QUAL O TIPO DE PRODUTO?": { value: "Seladora a vácuo", status: "filled" as const },
      },
      startedAt: new Date().toISOString(),
      status: "active" as const,
      messages: [],
    };
    expect(classifySessionToColumn(sessionMaquinas)).toBe("maquinas");

    const sessionAssistencia = {
      id: "test-6",
      conversationId: "conv-6",
      contactName: "Cliente Suporte",
      company: "Empresa Suporte",
      phone: "11999999999",
      currentStep: "Assistência",
      collectedData: {
        "TIPO DE QUALIFICAÇÃO": { value: "Assistência técnica", status: "filled" as const },
      },
      startedAt: new Date().toISOString(),
      status: "active" as const,
      messages: [],
    };
    expect(classifySessionToColumn(sessionAssistencia)).toBe("assistencia_tecnica");
  });

  it("deve classificar atendimentos concluídos genéricos na coluna outros", () => {
    const sessionCompleted = {
      id: "test-7",
      conversationId: "conv-7",
      contactName: "Cliente Concluído",
      company: "Empresa X",
      phone: "11999999999",
      currentStep: "Concluído",
      collectedData: {},
      startedAt: new Date().toISOString(),
      status: "completed" as const,
      outcome: "completed",
      messages: [],
    };
    expect(classifySessionToColumn(sessionCompleted)).toBe("outros");
  });

  it("deve classificar novos atendimentos sem qualificação na coluna triagem", () => {
    const sessionNew = {
      id: "test-8",
      conversationId: "conv-8",
      contactName: "Novo Lead",
      company: "Empresa Y",
      phone: "11999999999",
      currentStep: "Identificação",
      collectedData: {},
      startedAt: new Date().toISOString(),
      status: "active" as const,
      outcome: "in_progress",
      messages: [],
    };
    expect(classifySessionToColumn(sessionNew)).toBe("triagem");
  });

  it("deve conter os contatos do benchmark ativo (Teirs, Florencio, Lara, Rodrigo) e não conter os de problemas", () => {
    const names = BENCHMARK_SDR_SESSIONS.map((s) => s.contactName);
    expect(names).toContain("Teirs acessórios para maquinas");
    expect(names).toContain("Florencio Nascimento");
    expect(names).toContain("Lara");
    expect(names).toContain("Rodrigo");
    expect(names).not.toContain("STARK");
  });

  it("deve respeitar a persona correta por tenant (Fagner para tecfag, Valentina para valem)", () => {
    const personaTecfag = getAiPersona("tecfag");
    expect(personaTecfag.name).toBe("Fagner");

    const personaValem = getAiPersona("valem");
    expect(personaValem.name).toBe("Valentina");
  });

  it("deve ativar o indicador discreto direito quando a tela inicial cobre até PEÇAS e há clientes em OUTROS, calculando o scroll automático", () => {
    // Simula viewport inicial cobrindo de TRIAGEM (col 0) até PEÇAS (col 6): width = 1892px
    const containerWidth = 1892;
    const colWidth = 260;
    const gap = 12;

    const metrics: OffscreenColumnMetric[] = KANBAN_COLUMNS.map((col, idx) => {
      const left = idx * (colWidth + gap);
      return {
        key: col.key,
        label: col.label,
        accentColor: col.accentColor,
        count: col.key === "outros" ? 3 : col.key === "triagem" ? 4 : 0,
        visibleLeft: left,
        visibleRight: left + colWidth,
      };
    });

    const indicators = computeOffscreenKanbanIndicators(containerWidth, metrics);
    expect(indicators.left).toBeNull();
    expect(indicators.right).not.toBeNull();
    expect(indicators.right?.targetColumnKey).toBe("outros");
    expect(indicators.right?.targetColumnLabel).toBe("OUTROS");
    expect(indicators.right?.targetCount).toBe(3);

    // Ao clicar no indicador, calcula o scrollLeft exato para trazer OUTROS até a tela
    const outrosMetric = metrics.find((m) => m.key === "outros")!;
    const targetScrollLeft = getColumnScrollTarget({
      direction: "right",
      currentScrollLeft: 0,
      containerWidth,
      columnVisibleLeft: outrosMetric.visibleLeft,
      columnVisibleRight: outrosMetric.visibleRight,
      paddingPx: 8,
    });

    expect(targetScrollLeft).toBeGreaterThan(0);

    // Após rolar para targetScrollLeft, OUTROS passa a estar visível e o indicador direito some
    const metricsAfterScroll = metrics.map((m) => ({
      ...m,
      visibleLeft: m.visibleLeft - targetScrollLeft,
      visibleRight: m.visibleRight - targetScrollLeft,
    }));
    const indicatorsAfter = computeOffscreenKanbanIndicators(containerWidth, metricsAfterScroll);
    expect(indicatorsAfter.right).toBeNull();
    // E TRIAGEM (com 4 cards) que ficou para trás à esquerda ativa o indicador esquerdo
    expect(indicatorsAfter.left).not.toBeNull();
    expect(indicatorsAfter.left?.targetColumnKey).toBe("triagem");
    expect(indicatorsAfter.left?.targetCount).toBe(4);
  });
});

