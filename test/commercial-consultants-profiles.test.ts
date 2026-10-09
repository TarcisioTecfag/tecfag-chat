import { describe, expect, it } from "bun:test";

describe("Gestão Comercial - Perfis dos Consultores & Restrição de Início", () => {
  const mockOperators = [
    {
      id: "op-1",
      name: "Diana Gimenes",
      email: "vendas14@tecfag.com.br",
      division: "personnalite",
      activeOnTv: true,
      role: "operator",
    },
    {
      id: "op-2",
      name: "Marcelo Nardelli",
      email: "vendas17@tecfag.com.br",
      division: "personnalite",
      activeOnTv: true,
      role: "operator",
    },
    {
      id: "op-3",
      name: "Victor Goes",
      email: "vendas9@tecfag.com.br",
      division: "maquinas",
      activeOnTv: true,
      role: "operator",
    },
    {
      id: "op-4",
      name: "Melissa Gomes",
      email: "vendas3@tecfag.com.br",
      division: "maquinas",
      activeOnTv: true,
      role: "operator",
    },
    {
      id: "op-admin",
      name: "Tarcisio Admin",
      email: "suporte2@tecfag.com.br",
      division: null, // Administrador sem equipe comercial
      activeOnTv: false,
      role: "admin",
    },
    {
      id: "op-suporte",
      name: "Atendente Suporte",
      email: "suporte@tecfag.com.br",
      division: null, // Operador de suporte sem equipe comercial
      activeOnTv: false,
      role: "operator",
    },
  ];

  it("identifica estritamente consultores comerciais cadastrados com divisão válida", () => {
    const commercialConsultants = mockOperators.filter((op) => Boolean(op.division));
    expect(commercialConsultants.length).toBe(4);
    expect(commercialConsultants.map((c) => c.name)).toEqual([
      "Diana Gimenes",
      "Marcelo Nardelli",
      "Victor Goes",
      "Melissa Gomes",
    ]);
  });

  it("bloqueia tela de Início para usuários sem cadastro de consultor no Gestão Comercial", () => {
    const isCommercialConsultant = (op: (typeof mockOperators)[0]) => {
      return Boolean(op.division && op.division.trim() !== "");
    };

    expect(isCommercialConsultant(mockOperators[0])).toBe(true); // Diana
    expect(isCommercialConsultant(mockOperators[1])).toBe(true); // Marcelo
    expect(isCommercialConsultant(mockOperators[2])).toBe(true); // Victor
    expect(isCommercialConsultant(mockOperators[3])).toBe(true); // Melissa

    // Administrador e Suporte sem cadastro comercial não têm Início comercial
    expect(isCommercialConsultant(mockOperators[4])).toBe(false); // Admin
    expect(isCommercialConsultant(mockOperators[5])).toBe(false); // Suporte
  });

  it("permite à gestão inspecionar qualquer consultor na aba Perfis", () => {
    const commercialConsultants = mockOperators.filter((op) => Boolean(op.division));

    const getConsultantHomeTarget = (
      session: { role: string; id: string },
      queryOperatorId?: string,
    ) => {
      if (queryOperatorId && queryOperatorId !== session.id) {
        if (session.role !== "admin") {
          return { allowed: false, error: "FORBIDDEN" };
        }
        const target = commercialConsultants.find((c) => c.id === queryOperatorId);
        if (!target) {
          return { allowed: false, error: "NOT_A_CONSULTANT" };
        }
        return { allowed: true, targetOperatorId: target.id };
      }

      const ownProfile = commercialConsultants.find((c) => c.id === session.id);
      if (!ownProfile) {
        return { allowed: false, error: "NOT_A_CONSULTANT" };
      }
      return { allowed: true, targetOperatorId: session.id };
    };

    // Admin acessando o perfil de Diana Gimenes
    const adminViewingDiana = getConsultantHomeTarget({ role: "admin", id: "op-admin" }, "op-1");
    expect(adminViewingDiana.allowed).toBe(true);
    expect(adminViewingDiana.targetOperatorId).toBe("op-1");

    // Operador comum tentando ver perfil de outro é bloqueado com FORBIDDEN
    const opViewingOther = getConsultantHomeTarget({ role: "operator", id: "op-1" }, "op-2");
    expect(opViewingOther.allowed).toBe(false);
    expect(opViewingOther.error).toBe("FORBIDDEN");

    // Admin tentando ver Início de alguém que não é consultor comercial
    const adminViewingNonConsultant = getConsultantHomeTarget(
      { role: "admin", id: "op-admin" },
      "op-suporte",
    );
    expect(adminViewingNonConsultant.allowed).toBe(false);
    expect(adminViewingNonConsultant.error).toBe("NOT_A_CONSULTANT");
  });

  it("filtra galeria de perfis por equipes com contagens corretas", () => {
    const commercialConsultants = mockOperators.filter((op) => Boolean(op.division));
    const personnalite = commercialConsultants.filter((c) => c.division === "personnalite");
    const maquinas = commercialConsultants.filter((c) => c.division === "maquinas");

    expect(personnalite.length).toBe(2);
    expect(maquinas.length).toBe(2);
    expect(commercialConsultants.length).toBe(4);
  });
});
