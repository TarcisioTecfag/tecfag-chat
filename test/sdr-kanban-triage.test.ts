// ══════════════════════════════════════════════════════════════════════════════
// 🧪 TESTES UNITÁRIOS — KANBAN DE TRIAGEM SDR (FAGNER / VALENTINA)
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from "bun:test";
import {
  KANBAN_COLUMNS,
  classifySessionToColumn,
  BENCHMARK_SDR_SESSIONS,
  KanbanColumnKey,
} from "../src/components/valentina/sdr-kanban-data";
import { getAiPersona } from "../src/lib/ai-persona";

describe("SDR Kanban Board — Funis de Triagem", () => {
  it("deve conter exatamente as 11 colunas de funil na ordem especificada", () => {
    const expectedKeys: KanbanColumnKey[] = [
      "triagem",
      "assistencia_tecnica",
      "pos_venda",
      "maquinas",
      "personalite",
      "financeiro",
      "pecas",
      "avulso",
      "outros",
      "problemas",
      "sem_resposta",
    ];

    expect(KANBAN_COLUMNS.length).toBe(11);
    expect(KANBAN_COLUMNS.map((c) => c.key)).toEqual(expectedKeys);
  });

  it("deve possuir os rótulos em caixa alta idênticos às fotos de referência", () => {
    const labels = KANBAN_COLUMNS.map((c) => c.label);
    expect(labels).toContain("TRIAGEM");
    expect(labels).toContain("ASSISTÊNCIA TÉCNICA");
    expect(labels).toContain("PÓS VENDA");
    expect(labels).toContain("MÁQUINAS");
    expect(labels).toContain("PERSONNALITÉ");
    expect(labels).toContain("FINANCEIRO");
    expect(labels).toContain("PEÇAS");
    expect(labels).toContain("AVULSO");
    expect(labels).toContain("OUTROS");
    expect(labels).toContain("PROBLEMAS");
    expect(labels).toContain("SEM RESPOSTA");
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

  it("deve classificar problemas e escalações na coluna problemas", () => {
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
    expect(classifySessionToColumn(sessionProblem)).toBe("problemas");
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

  it("deve conter os contatos do benchmark das fotos anexadas (Teirs, Florencio, Lara, STARK, Rodrigo)", () => {
    const names = BENCHMARK_SDR_SESSIONS.map((s) => s.contactName);
    expect(names).toContain("Teirs acessórios para maquinas");
    expect(names).toContain("Florencio Nascimento");
    expect(names).toContain("Lara");
    expect(names).toContain("STARK");
    expect(names).toContain("Rodrigo");
  });

  it("deve respeitar a persona correta por tenant (Fagner para tecfag, Valentina para valem)", () => {
    const personaTecfag = getAiPersona("tecfag");
    expect(personaTecfag.name).toBe("Fagner");

    const personaValem = getAiPersona("valem");
    expect(personaValem.name).toBe("Valentina");
  });
});
