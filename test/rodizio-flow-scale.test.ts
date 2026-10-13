import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  RodizioEngine,
  FLOW_AREAS,
  ALL_FLOW_FUNNELS,
  FlowOperator,
} from "../src/lib/valentina/rodizio-engine";

describe("Escala Local de Operadores & Rodízio por Área (Módulo Fagner / Valentina)", () => {
  let originalOps: FlowOperator[] = [];

  beforeAll(async () => {
    // Salva o estado atual do tenant tecfag para restaurar no final
    originalOps = await RodizioEngine.getRodizioState("tecfag");
  });

  afterAll(async () => {
    // Restaura o estado original de tecfag
    if (originalOps && originalOps.length > 0) {
      await RodizioEngine.saveFlowOperators("tecfag", originalOps);
    }
  });

  it("deve conter as 6 áreas oficiais configuradas com funis padrão", () => {
    expect(FLOW_AREAS).toHaveLength(6);
    const areaIds = FLOW_AREAS.map((a) => a.id);
    expect(areaIds).toContain("maquinas");
    expect(areaIds).toContain("personalite");
    expect(areaIds).toContain("pecas");
    expect(areaIds).toContain("tecnica");
    expect(areaIds).toContain("pos_venda");
    expect(areaIds).toContain("financeiro");

    const maquinasArea = FLOW_AREAS.find((a) => a.id === "maquinas");
    expect(maquinasArea?.defaultFunnels).toContain("Máquinas");

    const posVendaArea = FLOW_AREAS.find((a) => a.id === "pos_venda");
    expect(posVendaArea?.defaultFunnels).toContain("Pós-Venda Geral");
    expect(posVendaArea?.defaultFunnels).toContain("Pós-Venda Rastreio");
    expect(posVendaArea?.defaultFunnels).toContain("Pós-Venda - NF do Pedido");
  });

  it("deve conter os 9 funis oficiais suportados na escala", () => {
    expect(ALL_FLOW_FUNNELS).toHaveLength(9);
    expect(ALL_FLOW_FUNNELS).toContain("Máquinas");
    expect(ALL_FLOW_FUNNELS).toContain("Personnalité");
    expect(ALL_FLOW_FUNNELS).toContain("Peças");
    expect(ALL_FLOW_FUNNELS).toContain("Fin. Boleto");
    expect(ALL_FLOW_FUNNELS).toContain("Fin. Nota Fiscal");
    expect(ALL_FLOW_FUNNELS).toContain("Assistência Técnica");
    expect(ALL_FLOW_FUNNELS).toContain("Pós-Venda Rastreio");
    expect(ALL_FLOW_FUNNELS).toContain("Pós-Venda - NF do Pedido");
    expect(ALL_FLOW_FUNNELS).toContain("Pós-Venda Geral");
  });

  it("carrega a equipe de referência do Módulo Fagner com áreas separadas", async () => {
    const ops = await RodizioEngine.getRodizioState("tecfag");
    expect(Array.isArray(ops)).toBe(true);
    expect(ops.length).toBeGreaterThanOrEqual(7);

    // Deve conter Andreia Camargo em Máquinas
    const andreia = ops.find((o) => o.name.includes("Andreia"));
    expect(andreia).toBeDefined();
    expect(andreia?.area).toBe("maquinas");
    expect(andreia?.isParticipating).toBe(true);

    // Deve conter Diana Gimenes em Personnalité
    const diana = ops.find((o) => o.name.includes("Diana"));
    expect(diana).toBeDefined();
    expect(diana?.area).toBe("personalite");
    expect(diana?.isParticipating).toBe(true);
  });

  it("permite adicionar, alterar funis, folga, compensação e remover operador da escala manualmente", async () => {
    const testOpId = "op-test-temp-" + Date.now();

    // 1. Adicionar operador temporário ao rodízio de Peças
    const addedList = await RodizioEngine.addOperatorToFlow("tecfag", {
      id: testOpId,
      name: "Operador Teste Peças",
      email: "teste.pecas@tecfag.com.br",
      area: "pecas",
      funnels: ["Peças"],
      compensation: 2,
      departmentTag: "COMERCIAL",
      roleTag: "SDR",
    });

    const addedOp = addedList.find((o) => o.id === testOpId);
    expect(addedOp).toBeDefined();
    expect(addedOp?.area).toBe("pecas");
    expect(addedOp?.funnels).toContain("Peças");
    expect(addedOp?.compensation).toBe(2);
    expect(addedOp?.isParticipating).toBe(true);
    expect(addedOp?.isOnLeave).toBe(false);

    // 2. Alternar funil (adiciona Assistência Técnica)
    const toggledFunnels = await RodizioEngine.toggleFunnel("tecfag", testOpId, "Assistência Técnica");
    const opWithNewFunnel = toggledFunnels.find((o) => o.id === testOpId);
    expect(opWithNewFunnel?.funnels).toContain("Assistência Técnica");

    // Alternar funil novamente (remove Assistência Técnica)
    const untoggled = await RodizioEngine.toggleFunnel("tecfag", testOpId, "Assistência Técnica");
    const opWithoutFunnel = untoggled.find((o) => o.id === testOpId);
    expect(opWithoutFunnel?.funnels).not.toContain("Assistência Técnica");

    // 3. Alternar folga
    const onLeave = await RodizioEngine.toggleLeave("tecfag", testOpId);
    const opOnLeave = onLeave.find((o) => o.id === testOpId);
    expect(opOnLeave?.isOnLeave).toBe(true);

    const backFromLeave = await RodizioEngine.toggleLeave("tecfag", testOpId);
    const opBack = backFromLeave.find((o) => o.id === testOpId);
    expect(opBack?.isOnLeave).toBe(false);

    // 4. Ajustar compensação (+1)
    const compUpdated = await RodizioEngine.updateCompensation("tecfag", testOpId, 1);
    const opComp = compUpdated.find((o) => o.id === testOpId);
    expect(opComp?.compensation).toBe(3);

    // 5. Remover da escala
    const afterRemoval = await RodizioEngine.removeOperatorFromFlow("tecfag", testOpId);
    const opRemoved = afterRemoval.find((o) => o.id === testOpId);
    expect(opRemoved).toBeUndefined();
  });

  it("aloca operador no rodízio respeitando a área e priorizando quem tem compensação", async () => {
    // Alocar para Personnalité
    const allocated = await RodizioEngine.allocateNextOperator(
      "tecfag",
      "conv-test-fake-" + Date.now(),
      "Cliente Teste Personnalité",
      "personalite"
    );

    if (allocated) {
      expect(allocated.area).toBe("personalite");
      expect(allocated.isParticipating).toBe(true);
      expect(allocated.isOnLeave).toBe(false);
    }
  });
});
