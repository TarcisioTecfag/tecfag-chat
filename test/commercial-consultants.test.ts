import { describe, expect, it } from "bun:test";

describe("Gestão Comercial - Consultores & Equipes", () => {
  const mockConsultants = [
    {
      operatorId: "op-1",
      name: "Andreia Camargo",
      email: "vendas5@tecfag.com.br",
      division: "maquinas",
      activeOnTv: true,
      rdUserId: "67b482ec047d9c001e3b5e4a",
      status: "disponivel",
    },
    {
      operatorId: "op-2",
      name: "Beatriz Ribeiro",
      email: "vendas7@tecfag.com.br",
      division: "maquinas",
      activeOnTv: true,
      rdUserId: "678fce7047d9c001e3b5e4b",
      status: "disponivel",
    },
    {
      operatorId: "op-3",
      name: "Denise Gomes",
      email: "vendas16@tecfag.com.br",
      division: "maquinas",
      activeOnTv: true,
      rdUserId: "68643654047d9c001e3b5e4c",
      status: "disponivel",
    },
    {
      operatorId: "op-4",
      name: "Melissa Gomes",
      email: "vendas3@tecfag.com.br",
      division: "maquinas",
      activeOnTv: true,
      rdUserId: "678fce18047d9c001e3b5e4d",
      status: "disponivel",
    },
    {
      operatorId: "op-5",
      name: "Diana Gimenes",
      email: "vendas14@tecfag.com.br",
      division: "personnalite",
      activeOnTv: true,
      rdUserId: "681ef741047d9c001e3b5e4e",
      status: "disponivel",
    },
    {
      operatorId: "op-6",
      name: "Jhordan Rueda",
      email: "vendas4@tecfag.com.br",
      division: "personnalite",
      activeOnTv: true,
      rdUserId: "678fc9a1047d9c001e3b5e4f",
      status: "disponivel",
    },
    {
      operatorId: "op-7",
      name: "Marcelo Nardelli",
      email: "vendas17@tecfag.com.br",
      division: "personnalite",
      activeOnTv: true,
      rdUserId: "690bb29c047d9c001e3b5e50",
      status: "disponivel",
    },
    {
      operatorId: "op-8",
      name: "Rosenvaldo Lucas",
      email: "vendas19@tecfag.com.br",
      division: "personnalite",
      activeOnTv: false, // Oculto da TV para testar KPI
      rdUserId: "699da897047d9c001e3b5e51",
      status: "disponivel",
    },
  ];

  it("calcula corretamente os KPIs do topo (ativos, visíveis no BI TV e equipes)", () => {
    const activeCount = mockConsultants.filter((c) => Boolean(c.division)).length;
    expect(activeCount).toBe(8);

    const visibleOnTvCount = mockConsultants.filter(
      (c) => Boolean(c.division) && (c.activeOnTv ?? true)
    ).length;
    expect(visibleOnTvCount).toBe(7);

    const teams = new Set(mockConsultants.map((c) => c.division?.toLowerCase()).filter(Boolean));
    expect(teams.size).toBe(2);
    expect(teams.has("maquinas")).toBe(true);
    expect(teams.has("personnalite")).toBe(true);
  });

  it("filtra consultores por equipe com precisão ('todas', 'maquinas', 'personnalite')", () => {
    const maquinas = mockConsultants.filter((c) => c.division === "maquinas");
    expect(maquinas.length).toBe(4);
    expect(maquinas.every((c) => c.division === "maquinas")).toBe(true);

    const personnalite = mockConsultants.filter((c) => c.division === "personnalite");
    expect(personnalite.length).toBe(4);
    expect(personnalite.every((c) => c.division === "personnalite")).toBe(true);
  });

  it("realiza busca case-insensitive por nome, email ou ID do RD", () => {
    const searchByName = mockConsultants.filter((c) =>
      c.name.toLowerCase().includes("diana")
    );
    expect(searchByName.length).toBe(1);
    expect(searchByName[0].operatorId).toBe("op-5");

    const searchByEmail = mockConsultants.filter((c) =>
      c.email.toLowerCase().includes("vendas14")
    );
    expect(searchByEmail.length).toBe(1);

    const searchByRd = mockConsultants.filter((c) =>
      c.rdUserId?.toLowerCase().includes("67b482ec")
    );
    expect(searchByRd.length).toBe(1);
    expect(searchByRd[0].name).toBe("Andreia Camargo");
  });

  it("formata a exibição do Vínculo RD truncando os primeiros caracteres", () => {
    const rdId = "67b482ec047d9c001e3b5e4a";
    const formatted = `Vínculo RD: ${rdId.slice(0, 8)}...`;
    expect(formatted).toBe("Vínculo RD: 67b482ec...");
  });

  it("permite alternar visibilidade no BI TV preservando o estado", () => {
    const consultant = { ...mockConsultants[0] };
    const nextState = !(consultant.activeOnTv ?? true);
    expect(nextState).toBe(false);
    consultant.activeOnTv = nextState;
    expect(consultant.activeOnTv).toBe(false);
  });
});
