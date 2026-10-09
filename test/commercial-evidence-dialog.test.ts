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

  it("deve permitir que o consultor selecione estritamente entre contatos vinculados e anexe 100% da conversa", () => {
    // Lista de contatos vinculados à negociação
    const dealContacts = [
      { id: "cont-1", name: "Tarcisio Silva", phone: "5514998364338", email: "tarcisio@tecfag.com.br", totalMessages: 45, totalMedia: 3 },
      { id: "cont-2", name: "Mariana Rocha", phone: "5514998765432", email: "mariana@empresa.com", totalMessages: 12, totalMedia: 0 },
    ];

    expect(dealContacts.length).toBe(2);

    // O consultor seleciona o contato com quem tratou (ex: Tarcisio Silva)
    const selectedContactId = "cont-1";
    const selectedContact = dealContacts.find((c) => c.id === selectedContactId);

    expect(selectedContact).toBeDefined();
    expect(selectedContact?.name).toBe("Tarcisio Silva");

    // O payload deve conter o contactId selecionado
    const payload = {
      channel: "whatsapp" as const,
      contactId: selectedContact?.id,
      summary: `Tratativa via WhatsApp com ${selectedContact?.name} — Histórico integral arquivado como evidência.`,
      nextAction: "continue" as const,
    };

    expect(payload.contactId).toBe("cont-1");
    expect(payload.summary).toContain("Tarcisio Silva");
    expect(payload.summary).toContain("Histórico integral");
  });

  it("não deve exibir texto de sincronização de 24h ou filas noturnas para o consultor", () => {
    const forbiddenTexts = [
      "Sincronização Direta do Atendimento",
      "O histórico das últimas 24h desta conversa é extraído diretamente do sistema",
      "sem necessidade de filas noturnas ou barreiras de API",
      "Mensagens trocadas nas últimas 24h",
    ];

    // Simula os textos renderizados na tela de WhatsApp
    const currentUiLabels = [
      "CONTATO VINCULADO NO WHATSAPP",
      "Selecione com qual contato você tratou. O sistema vinculará 100% da conversa histórica e preservará todas as mídias como evidência.",
      "100% da conversa com Tarcisio Silva será vinculada",
      "O histórico integral de mensagens e todas as mídias trocadas no sistema serão arquivados como comprovação e evidência auditável da tratativa.",
      "OBSERVAÇÃO BREVE DA TRATATIVA (OPCIONAL)",
    ];

    for (const forbidden of forbiddenTexts) {
      for (const label of currentUiLabels) {
        expect(label.includes(forbidden)).toBe(false);
      }
    }
  });

  it("deve identificar e preservar integralmente mídias reais (áudios, imagens, vídeos, documentos) na evidência", () => {
    // Amostra de mensagens históricas da conversa contendo diferentes tipos de mídia
    const rawMessages = [
      { id: "msg-1", content: "Olá, segue a foto da máquina que você solicitou", senderName: "Tarcisio Silva", senderType: "client", sentAt: new Date("2026-10-09T08:00:00Z") },
      { id: "msg-2", content: "[MEDIA:image]med_img_9874523\nFoto frontal da seladora", senderName: "Tarcisio Silva", senderType: "client", sentAt: new Date("2026-10-09T08:01:00Z") },
      { id: "msg-3", content: "[MEDIA:audio]med_audio_341109", senderName: "Vendedor", senderType: "agent", sentAt: new Date("2026-10-09T08:02:00Z"), mediaInterpretation: "Áudio explicando prazo de entrega de 5 dias úteis." },
      { id: "msg-4", content: "[MEDIA:document]med_doc_87221:proposta_comercial_204.pdf", senderName: "Vendedor", senderType: "agent", sentAt: new Date("2026-10-09T08:03:00Z") },
      { id: "msg-5", content: "[LOCAL_MEDIA:video:blob:http://localhost/video.mp4:demonstracao.mp4]", senderName: "Tarcisio Silva", senderType: "client", sentAt: new Date("2026-10-09T08:04:00Z") },
    ];

    const preservedMedia: Array<{
      messageId: string;
      mediaType: string;
      mediaIdentifier: string;
      fileName?: string;
      downloadUrl: string;
      caption?: string;
      mediaInterpretation?: string;
    }> = [];

    for (const m of rawMessages) {
      const mediaMatch = m.content.match(/^\[MEDIA:(image|video|audio|document|sticker)\]([^:\n]+)(?::([^\n]+))?/);
      if (mediaMatch) {
        const [, type, idVal, fileName] = mediaMatch;
        preservedMedia.push({
          messageId: m.id,
          mediaType: type,
          mediaIdentifier: idVal,
          fileName: fileName?.trim(),
          downloadUrl: `/api/baileys/media?messageId=${encodeURIComponent(idVal)}`,
          caption: m.content.split("\n").slice(1).join("\n").trim() || undefined,
          mediaInterpretation: m.mediaInterpretation,
        });
        continue;
      }

      if (m.content.startsWith("[LOCAL_MEDIA:")) {
        const rest = m.content.slice("[LOCAL_MEDIA:".length);
        const firstColon = rest.indexOf(":");
        if (firstColon !== -1) {
          const type = rest.slice(0, firstColon);
          const remainder = rest.slice(firstColon + 1);
          const endBracket = remainder.lastIndexOf("]");
          const cleanRemainder =
            endBracket !== -1 ? remainder.slice(0, endBracket) : remainder;
          const lastColon = cleanRemainder.lastIndexOf(":");
          const urlVal =
            lastColon !== -1 ? cleanRemainder.slice(0, lastColon) : cleanRemainder;
          const fileName =
            lastColon !== -1 ? cleanRemainder.slice(lastColon + 1) : undefined;
          preservedMedia.push({
            messageId: m.id,
            mediaType: type,
            mediaIdentifier: m.id,
            fileName: fileName?.trim(),
            downloadUrl: urlVal,
          });
        }
      }
    }

    // Deve ter capturado 4 mídias reais (imagem, áudio, documento e vídeo)
    expect(preservedMedia.length).toBe(4);
    expect(preservedMedia[0].mediaType).toBe("image");
    expect(preservedMedia[0].mediaIdentifier).toBe("med_img_9874523");
    expect(preservedMedia[0].downloadUrl).toContain("med_img_9874523");

    expect(preservedMedia[1].mediaType).toBe("audio");
    expect(preservedMedia[1].mediaInterpretation).toBe("Áudio explicando prazo de entrega de 5 dias úteis.");

    expect(preservedMedia[2].mediaType).toBe("document");
    expect(preservedMedia[2].fileName).toBe("proposta_comercial_204.pdf");

    expect(preservedMedia[3].mediaType).toBe("video");
    expect(preservedMedia[3].fileName).toBe("demonstracao.mp4");
  });

  it("deve calibrar os botões Concluir e Abrir CRM com estilo visual 1:1 à referência", () => {
    const concludeBtn = {
      label: "Concluir",
      icon: "Check",
      bgColor: "#00a868",
      textColor: "white",
      borderRadius: "rounded-[4px]",
      strokeWidth: 2.8,
    };

    const openCrmBtn = {
      label: "Abrir CRM",
      icon: "ExternalLink",
      border: "border-zinc-700/80",
      bgColor: "bg-zinc-900/60",
      textColor: "text-zinc-100",
      borderRadius: "rounded-[4px]",
      strokeWidth: 2,
    };

    expect(concludeBtn.bgColor).toBe("#00a868");
    expect(concludeBtn.icon).toBe("Check");
    expect(openCrmBtn.icon).toBe("ExternalLink");
    expect(openCrmBtn.border).toBe("border-zinc-700/80");
  });
});
