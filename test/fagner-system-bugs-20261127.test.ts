import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildMetaMediaDownloadFailureNotice,
  classifyMetaMediaDownloadError,
  MAX_META_MEDIA_RECOVERY_ATTEMPTS,
} from "../src/lib/whatsapp/meta-media-error";
import { guardVtexMessages } from "../src/lib/vtex/turn";
import {
  isAutomatedBotOrUraMessage,
  isClientDecliningTriage,
} from "../src/lib/triage/industrial-policy";
import { projectIndustrialMonitoring } from "../src/lib/triage/industrial-monitor";

describe("Correções de Bugs de Sistema — Auditoria 27/11/2026", () => {
  describe("1. Mídia Meta: classificação permanente vs transitória, aviso visível e fim do loop 500", () => {
    it("classifica mídia > 20 MB, 404/410/#100/expirada e mismatch como permanentes (sem loop 500)", () => {
      const tooLarge = classifyMetaMediaDownloadError(
        new Error("Mídia Meta excede o limite operacional de 20 MB"),
      );
      expect(tooLarge.permanent).toBe(true);
      expect(tooLarge.category).toBe("too_large");

      const expired404 = classifyMetaMediaDownloadError(
        new Error("Meta retornou HTTP 404 ao consultar mídia: (#100) Media ID does not exist"),
      );
      expect(expired404.permanent).toBe(true);
      expect(expired404.category).toBe("expired_or_missing");

      const gone410 = classifyMetaMediaDownloadError(
        new Error("Download de mídia Meta falhou: HTTP 410"),
      );
      expect(gone410.permanent).toBe(true);
      expect(gone410.category).toBe("expired_or_missing");

      const mismatch = classifyMetaMediaDownloadError(
        new Error("Mídia não pertence ao número configurado para o tenant"),
      );
      expect(mismatch.permanent).toBe(true);
      expect(mismatch.category).toBe("tenant_mismatch");
    });

    it("classifica timeout, 429 e 5xx como transitórios e redige tokens sensíveis", () => {
      const timeoutErr = classifyMetaMediaDownloadError(new Error("The operation timed out"));
      expect(timeoutErr.permanent).toBe(false);
      expect(timeoutErr.category).toBe("transient");

      const server502 = classifyMetaMediaDownloadError(
        new Error("Download de mídia Meta falhou: HTTP 502 Bearer EAAGsecret123 access_token=xyz"),
      );
      expect(server502.permanent).toBe(false);
      expect(server502.category).toBe("transient");
      expect(server502.safeReason).not.toContain("EAAGsecret123");
      expect(server502.safeReason).not.toContain("access_token=xyz");
      expect(MAX_META_MEDIA_RECOVERY_ATTEMPTS).toBeGreaterThanOrEqual(5);
    });

    it("gera aviso claro em PT-BR preservando tipo de mídia, arquivo e legenda do cliente", () => {
      const videoNotice = buildMetaMediaDownloadFailureNotice({
        mediaType: "video",
        category: "too_large",
        caption: "Vídeo da máquina dando choque",
      });
      expect(videoNotice).toContain("Vídeo enviado pelo cliente excedeu o limite de 20 MB");
      expect(videoNotice).toContain("Vídeo da máquina dando choque");

      const docNotice = buildMetaMediaDownloadFailureNotice({
        mediaType: "document",
        category: "expired_or_missing",
        fileName: "comprovante.pdf",
      });
      expect(docNotice).toContain("Documento (comprovante.pdf)");
      expect(docNotice).toContain("peça para reenviar");
    });

    it("webhook Meta e durable-recovery logam erro real, entregam aviso e preservam isolamento multi-tenant", () => {
      const webhookSrc = fs.readFileSync(path.resolve("src/routes/api/webhooks/meta.ts"), "utf8");
      const recoverySrc = fs.readFileSync(
        path.resolve("src/lib/whatsapp/durable-recovery.ts"),
        "utf8",
      );
      expect(webhookSrc).toContain("classifyMetaMediaDownloadError(mediaErr)");
      expect(webhookSrc).toContain("buildMetaMediaDownloadFailureNotice");
      expect(webhookSrc).toContain(
        "category=${classified.category}, permanent=${classified.permanent}",
      );
      expect(recoverySrc).toContain("classifyMetaMediaDownloadError(err)");
      expect(recoverySrc).toContain("MAX_META_MEDIA_RECOVERY_ATTEMPTS");
      expect(recoverySrc).toContain("errorMessage: classified.safeReason");
    });
  });

  describe("2. guardVtexMessages: libera código de modelo/data e preço já enviado no template Black, bloqueia alucinações", () => {
    const blackTemplate =
      "Opa, tudo bem? É o Fagner aqui da TecFag.\n\nVocês já compraram a HZK160 com a gente — e na Black Friday, que vai até 30 de novembro, ela tá por R$ 757,99.";

    it("não gera falso positivo com dígitos em código de modelo (HZK160, A3) ou data (30 de novembro)", () => {
      const msgs = [
        "Combinado! Vou reservar o valor promocional da HZK160 até 30 de novembro.",
        "A condição especial com valor da A3 na Black Friday segue válida até 30/11.",
      ];
      expect(guardVtexMessages(msgs, [], { trustedCommercialHistory: [blackTemplate] })).toEqual(
        msgs,
      );
    });

    it("permite repetir exatamente o preço já enviado pela própria empresa no template Black Friday", () => {
      const msgs = [
        "Ótimo! A HZK160 está por R$ 757,99 na Black Friday.",
        "Para gerar seu pedido, qual seu nome completo e CNPJ?",
      ];
      expect(guardVtexMessages(msgs, [], { trustedCommercialHistory: [blackTemplate] })).toEqual(
        msgs,
      );
    });

    it("continua bloqueando preço inventado diferente do template, frete grátis, prazo ou estoque", () => {
      const blocked = guardVtexMessages(
        [
          "A HZK160 está por R$ 500,00 hoje.",
          "Sai por R$ 757,99 com frete grátis!",
          "A entrega chega em 2 dias úteis.",
          "Temos o produto disponível em estoque.",
        ],
        [],
        { trustedCommercialHistory: [blackTemplate] },
      );
      expect(blocked).toEqual([
        "Preço, disponibilidade e prazo precisam ser confirmados na consulta da loja ou pela equipe responsável.",
      ]);
    });
  });

  describe("3. Detector de URA / Bot externo: cobre os 14 casos reais da rajada outbound sem falso positivo", () => {
    const realExternalBots = [
      "A 🏆🇧🇷Escuderia do Brasil agora terá atendimento pelo WhatsApp da marca irmã Studio Olfativo por favor chame no número (19) 99614 2938 para receber atendimento",
      "Olá! 👋 Seja bem-vindo(a) à ABC-LAB! 🔬 Recebemos sua mensagem e, em breve, um de nossos atendentes entrará em contato para ajudar.",
      "Olá! Seja bem-vindo à SOFISTIC. ✨ Trabalhamos com aromatização profissional de ambientes e marketing olfativo.",
      "Agradecemos sua mensagem. Não estamos disponíveis no momento, mas entraremos em contato assim que possível.",
      "Olá, tudo bem? Seja bem-vinda (a) ✨ É um prazer ter você por aqui. Fique à vontade para me contar o que você procura.",
      "*_A CASA DO KOMBUCHÁ_* _AGRADECE SEU CONTATO_ *_Temos uma lista de espera SEQUENCIAL assim que possível retornaremos_*",
      "\u200eDental Sucesso agradece seu contato. Como podemos ajudar?",
      "Olá seja bem vinda (o) a Delícias Totoka! Como podemos lhe ajudar? *No momento não estamos disponível.* *Nosso horário de atendimento é de segunda a sexta*",
      "LYV PRODUTOS NATURAIS E GERIZIN CONFECÇÃO JUNTAS PARA MELHOR ATENDER VOCÊ. SEJAM BEM VINDOS🤝COMO PODEMOS LHE AJUDAR ?",
      "COOPEFRUT agradece seu contato. Como podemos ajudar?",
      "\u200esilagem schemmer agradece seu contato. Como podemos ajudar?",
      "\u200eCompras agradece seu contato. Como podemos ajudar?",
      "Olá, Seja bem-vindo!! É um prazer atende-la (o). Faça seu pedido no link abaixo. https://instadelivery.com.br/docesinfonia",
      "\u200eNando Luz agradece seu contato. Como podemos ajudar? 1 DJ 2 Som,Palco, Iluminação 3 Painel de Led 4 Pista Paris 5 Coquetel",
    ];

    it("detecta todos os 14 bots/URAs reais do WhatsApp Business", () => {
      for (const text of realExternalBots) {
        expect(isAutomatedBotOrUraMessage({ phone: "5511999990000", text })).toBe(true);
      }
    });

    it("não gera falso positivo em mensagens reais de clientes pedindo máquinas, peças ou suporte", () => {
      const realHumans = [
        "Bom dia! Agradeço o contato, quero comprar uma seladora a vácuo para 300kg/dia",
        "Olá, seja bem-vindo ao nosso contato. Preciso de orçamento para uma envasadora HZK160",
        "Agradeço seu contato! Minha máquina quebrou e não liga, preciso de suporte",
        "Oi, tudo bem? Gostaria de saber quanto custa a rotuladora MT50",
        "Sim, tenho interesse nas condições da Black Friday",
      ];
      for (const text of realHumans) {
        expect(isAutomatedBotOrUraMessage({ phone: "5511999990000", text })).toBe(false);
      }
    });
  });

  describe("4. Desistência limpa (Amanda Almeida / Geraldo) & visibilidade de dismissedBy no monitor", () => {
    it("encerra limpo 'já resolvemos' e 'já comprou/comprei a máquina' sem poluir awaiting_approval", () => {
      expect(
        isClientDecliningTriage("Este produto era para revenda, já resolvemos já. Obrigada!"),
      ).toBe(true);
      expect(isClientDecliningTriage("Já foi resolvido, obrigado")).toBe(true);
      expect(
        isClientDecliningTriage(
          "O cliente informa em áudio que já comprou a máquina que estava procurando.",
        ),
      ).toBe(true);
      expect(
        isClientDecliningTriage("Obrigado, eu já comprei a máquina que estava precisando."),
      ).toBe(true);

      // Continua NÃO disparando quando há nova demanda ativa junto
      expect(
        isClientDecliningTriage(
          "Já comprei a máquina, mas agora preciso de peças de reposição e teflon",
        ),
      ).toBe(false);
      expect(
        isClientDecliningTriage("Já comprei a máquina com vocês, mas ela deu defeito e não liga"),
      ).toBe(false);
      expect(
        isClientDecliningTriage("Já comprei a máquina mas quero comprar mais uma na Black Friday"),
      ).toBe(false);
    });

    it("projectIndustrialMonitoring expõe sdrHiddenByName, sdrHiddenAt e dismissedReason a partir de dismissedBy", () => {
      const mon = projectIndustrialMonitoring(
        {
          id: "flow-matheus",
          outcome: "completed",
          currentStep: "Concluído (Sem Transferência)",
          startedAt: new Date("2026-11-27T14:08:38.497Z"),
          metadata: {
            handoffStatus: "resolved",
            dismissedBy: {
              operatorId: "op-isabella",
              operatorName: "Isabella Inhesta",
              reason: "Vai realizar a compra só em 2027.",
              at: "2026-11-27T16:00:12.142Z",
            },
          },
        },
        { queueState: "finalizados", operatorId: null },
      );

      expect(mon.state).toBe("closed");
      expect(mon.sdrHidden).toBe(true);
      expect(mon.sdrHiddenByName).toBe("Isabella Inhesta");
      expect(mon.sdrHiddenAt).toBe("2026-11-27T16:00:12.142Z");
      expect(mon.dismissedReason).toBe("Vai realizar a compra só em 2027.");
    });
  });
});
