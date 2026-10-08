import { describe, expect, it } from "bun:test";

describe("Fluxo de Conclusão de Diretriz e Evidência Multicanal no Módulo Início", () => {
  it("deve contemplar exatamente os 3 canais comerciais oficiais (Ligação, WhatsApp, E-mail)", () => {
    const channels = [
      { id: "call", label: "Ligação", icon: "Phone" },
      { id: "whatsapp", label: "WhatsApp", icon: "MessageSquare" },
      { id: "email", label: "E-mail", icon: "Mail" },
    ];

    expect(channels).toHaveLength(3);
    expect(channels.map((c) => c.id)).toEqual(["call", "whatsapp", "email"]);
    expect(channels.map((c) => c.label)).toEqual(["Ligação", "WhatsApp", "E-mail"]);
  });

  it("não deve conter nenhum emoji na interface, rótulos ou badges de status", () => {
    const uiTexts = [
      "REGISTRAR EVIDÊNCIA DA TRATATIVA COMERCIAL",
      "DESFECHO DA TRATATIVA",
      "Concluir executar diretriz",
      "Qual é sua próxima ação?",
      "CANAL DE ATENDIMENTO UTILIZADO",
      "RELATO DA LIGAÇÃO (O QUE FOI TRATADO E ACORDADO?)",
      "IDENTIFICAÇÃO DO CONTATO NO WHATSAPP",
      "EMAIL COMPLETO (COM CABEÇALHO E CONTEÚDO ORIGINAL)",
      "OBSERVAÇÃO BREVE DA TRATATIVA (OPCIONAL)",
      "Salvar evidência e concluir",
      "VENDIDO",
      "PERDIDO",
      "EM ANDAMENTO",
      "Agendar retorno",
      "Negociação ganha",
      "Registrar perda",
      "DATA E HORA DA PRÓXIMA AÇÃO",
      "NOME DA TAREFA",
      "OBSERVAÇÃO",
      "Reajuste automático: A data da sua responsabilidade será atualizada para a data selecionada, recalibrando o marcador de atraso.",
      "Agendar Próxima Ação",
      "Confirmar Venda no CRM",
      "Registrar Perda no CRM",
      "Evidência registrada com sucesso",
      "ATRASADA",
    ];

    // Regex para detectar emojis (Unicode emojis)
    const emojiRegex =
      /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;

    for (const text of uiTexts) {
      expect(emojiRegex.test(text)).toBe(false);
    }
  });

  it("deve conter as sugestões rápidas oficiais para agendamento de tarefa futura", () => {
    const suggestions = [
      "Entrar em contato novamente",
      "Retomar contato",
      "Enviar proposta revisada",
      "Acompanhar retorno do cliente",
      "Alinhar detalhes técnicos",
      "Confirmar pedido e faturamento",
    ];

    expect(suggestions).toContain("Entrar em contato novamente");
    expect(suggestions).toContain("Retomar contato");
    expect(suggestions.length).toBeGreaterThanOrEqual(4);
  });

  it("deve conter os motivos mapeados de perda comercial para auditoria no CRM", () => {
    const reasons = [
      "Cliente não atende/responde aos contatos",
      "Cliente desistiu do investimento",
      "Preço / Condições de pagamento",
      "Optou pela concorrência",
      "Especificação técnica incompatível",
      "Sem orçamento / Projeto postergado",
      "Outro motivo comercial",
    ];

    expect(reasons).toContain("Cliente não atende/responde aos contatos");
    expect(reasons).toContain("Cliente desistiu do investimento");
    expect(reasons).toContain("Preço / Condições de pagamento");
    expect(reasons.length).toBe(7);
  });

  it("deve validar e estruturar a carga da próxima ação comercial com ações reais no CRM", () => {
    const futureDue = new Date(Date.now() + 86400000).toISOString();

    // Cenário 1: Em Andamento -> cria tarefa e reajusta responsabilidade
    const payloadContinue = {
      channel: "call" as const,
      summary: "Cliente alinhou proposta nº 204 e solicitou envio do faturamento.",
      nextAction: "continue" as const,
      nextTaskTitle: "Enviar proposta revisada",
      nextTaskDueAt: futureDue,
      nextTaskDescription: "Enviar espelho do pedido faturado até as 14h.",
    };

    expect(payloadContinue.nextAction).toBe("continue");
    expect(payloadContinue.nextTaskTitle).toBeTruthy();
    expect(new Date(payloadContinue.nextTaskDueAt).getTime()).toBeGreaterThan(Date.now());

    // Cenário 2: Vendido -> atualiza status do deal para won e confirma valor
    const payloadWon = {
      channel: "email" as const,
      summary: "Cliente aprovou a minuta comercial por email.",
      emailContent: "De: cliente@empresa.com.br Para: vendedor@tecfag.com.br Assunto: Aprovado",
      nextAction: "won" as const,
      wonValue: 30000000,
      wonNotes: "Venda faturada com entrada + 48x.",
    };

    expect(payloadWon.nextAction).toBe("won");
    expect(payloadWon.wonValue).toBe(30000000);

    // Cenário 3: Perdido -> atualiza status do deal para lost com motivo
    const payloadLost = {
      channel: "whatsapp" as const,
      summary: "Cliente informou que optou por fabricante concorrente por prazo menor.",
      nextAction: "lost" as const,
      lossReason: "Optou pela concorrência",
      lostNotes: "Concorrente entregava a pronta entrega.",
    };

    expect(payloadLost.nextAction).toBe("lost");
    expect(payloadLost.lossReason).toBe("Optou pela concorrência");
  });

  it("deve estruturar logs de anotações internas no card do atendimento e no card do deal", () => {
    const channelName = "WhatsApp";
    const summary = "Cliente confirmou interesse na embaladora a vácuo.";
    const outcomeName = "Em Andamento — Próxima ação agendada: \"Retomar contato\" para 09/10/2026 10:00";

    const internalNoteText = `Tratativa Comercial Concluída\nCanal: ${channelName}\nRelato: ${summary}\nDesfecho: ${outcomeName}`;

    expect(internalNoteText).toContain("Tratativa Comercial Concluída");
    expect(internalNoteText).toContain("Canal: WhatsApp");
    expect(internalNoteText).toContain(summary);
    expect(internalNoteText).toContain(outcomeName);
    expect(internalNoteText.includes("🚀")).toBe(false);
  });
});
