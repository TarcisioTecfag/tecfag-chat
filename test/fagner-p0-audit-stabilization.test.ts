import { describe, expect, it } from "bun:test";
import {
  claimsIndustrialHandoffEffect,
  industrialClientMessages,
  isPrematureIndustrialHandoffBubble,
} from "../src/lib/triage/industrial-handoff";
import { resolveIndustrialRoute } from "../src/lib/triage/industrial-policy";
import {
  buildKnownClientPromptDirective,
  isValidKnownCompanyName,
  looksLikePersonalNameUsedAsCompany,
} from "../src/lib/triage/known-client-lookup";
import { sortIndustrialRodizioCandidatesWithPendingLoad } from "../src/lib/triage/industrial-approval-store";
import { deriveVtexQuery, guardVtexMessages } from "../src/lib/vtex/turn";

describe("Pacote P0 — Estabilização das triagens do Fagner (auditoria 25/11/2026)", () => {
  describe("1. industrialClientMessages: filtragem cirúrgica por balão sem destruir empatia nem emitir frase fantasma", () => {
    it("preserva empatia e pergunta contextual (caso Lincoln / garantia) removendo apenas o balão de promessa prematura", () => {
      const route = resolveIndustrialRoute({
        text: "Comprei uma máquina nova e deu problema, quero ver a garantia",
        collectedData: {},
      });
      const messages = [
        "Lamento pelo problema na sua máquina nova. Vamos verificar a questão da garantia.",
        "Já estou encaminhando seu caso para nossa equipe de suporte técnico.",
        "Para agilizar o atendimento, qual é o seu nome completo?",
      ];

      const sanitized = industrialClientMessages({
        result: { status: "collecting", operator: null, deal: null },
        route,
        data: {},
        messages,
      });

      expect(sanitized).toEqual([
        "Lamento pelo problema na sua máquina nova. Vamos verificar a questão da garantia.",
        "Para agilizar o atendimento, qual é o seu nome completo?",
      ]);
    });

    it("preserva balão informativo e acrescenta apenas a pergunta faltante quando a IA não fez pergunta", () => {
      const route = resolveIndustrialRoute({
        text: "Quero uma envasadora para creme cosmético",
        collectedData: {
          "MÁQUINA / PEÇA / INTERESSE": { value: "Envasadora de creme", status: "filled" },
        },
      });
      const messages = [
        "Entendido! Temos envasadoras pneumáticas e elétricas para creme cosmético.",
        "Vou direcionar sua solicitação para um de nossos especialistas comerciais.",
      ];

      const sanitized = industrialClientMessages({
        result: { status: "collecting", operator: null, deal: null },
        route,
        data: {
          "MÁQUINA / PEÇA / INTERESSE": { value: "Envasadora de creme", status: "filled" },
        },
        messages,
      });

      expect(sanitized).toEqual([
        "Entendido! Temos envasadoras pneumáticas e elétricas para creme cosmético.",
        "Pode me informar seu nome?",
      ]);
    });

    it("NÃO considera pergunta contextual com '?' como promessa prematura (exceto alegação falsa de servidor)", () => {
      expect(
        isPrematureIndustrialHandoffBubble(
          "Para que nosso especialista possa verificar a garantia e entrar em contato, qual o seu nome?",
        ),
      ).toBe(false);
      expect(
        isPrematureIndustrialHandoffBubble(
          "Já transferi seu atendimento para Maria, pode me confirmar seu nome?",
        ),
      ).toBe(true);
      expect(
        claimsIndustrialHandoffEffect([
          "Para que o especialista possa preparar a proposta, qual o seu CNPJ?",
        ]),
      ).toBe(false);
    });

    it("NUNCA emite a frase fantasma 'As informações do atendimento estão registradas...' em collecting sem subflow (casos Psyta kids, Alex Alex)", () => {
      const route = resolveIndustrialRoute({
        text: "Olá! Gostaria de saber mais sobre as soluções da Tecfag.",
        collectedData: {},
      });

      const sanitized = industrialClientMessages({
        result: { status: "collecting", operator: null, deal: null },
        route,
        data: {},
        messages: ["Vou direcionar seu atendimento para a equipe responsável."],
      });

      expect(sanitized.join(" ")).not.toContain("informações do atendimento estão registradas");
      expect(sanitized[0]).toContain("?");
    });
  });

  describe("2. VTEX interceptor e guardrail (casos Fernando, Amanda, José Carlos, Valdeir)", () => {
    it("NUNCA interpreta CPF (11 dígitos) ou CNPJ (14 dígitos) como SKU mesmo após status='choices'", () => {
      const prevChoices = { status: "choices" as const, selectedSkuId: null };
      for (const doc of [
        "66850725000187",
        "66.850.725/0001-87",
        "CNPJ 66850725000187",
        "04217604947",
        "042.176.049-47",
        "CPF: 04217604947",
      ]) {
        expect(deriveVtexQuery(doc, null, prevChoices)).toBeNull();
      }
      // SKU curto continua funcionando normalmente em choices
      const validSkuChoice = deriveVtexQuery("596", null, prevChoices);
      expect(validSkuChoice?.query).toMatchObject({ kind: "sku", value: "596" });
    });

    it("extrai ?idsku=596 da URL enviada pelo cliente para evitar loop de variantes (caso Fernando)", () => {
      const res = deriveVtexQuery(
        "https://www.tecfag.com.br/seladora-a-vacuo-com-reservatorio---dz280-2se/p?idsku=596&utm_source=google-shopping",
        null,
      );
      expect(res?.query).toMatchObject({
        kind: "url",
        skuId: "596",
      });
    });

    it("NÃO transforma 'valor de pix' ou termos de parcelamento em busca de produto (caso José Carlos)", () => {
      const res = deriveVtexQuery(
        "Gostaria de ver se consegue alguma negociação de valores dela, em 12x sem juros no valor de pix",
        null,
      );
      expect(res?.query).toBeNull();
    });

    it("guardVtexMessages preserva resposta sobre foto/desconto sem valores inventados (caso Valdeir) e mantém bloqueio de preço/estoque", () => {
      const safeReplies = [
        "Não tenho foto disponível aqui no sistema, mas posso te ajudar a escolher a seladora ideal.",
        "Sobre o desconto da Black Friday, nosso especialista confirma as condições comerciais para você.",
      ];
      expect(guardVtexMessages(safeReplies)).toEqual(safeReplies);

      const blockedReplies = [
        "Custa R$ 599,00 à vista",
        "Temos o produto disponível em estoque",
        "Conseguimos 20% de desconto hoje",
        "Entrega em 3 dias úteis",
        "Frete grátis para todo o Brasil",
      ];
      const out = guardVtexMessages(blockedReplies);
      expect(out).toEqual([
        "Preço, disponibilidade e prazo precisam ser confirmados na consulta da loja ou pela equipe responsável.",
      ]);
    });
  });

  describe("3. Sanitização de razão social e nome pessoal (casos Cicero Manoel, Valdônio, André Silva)", () => {
    it("rejeita prefixos internos como 'FAGNER | ...' como nome de empresa", () => {
      expect(isValidKnownCompanyName("FAGNER | Cicero Manoel da Silva Santos")).toBe(false);
      expect(isValidKnownCompanyName("VALENTINA | Cliente X")).toBe(false);
      expect(isValidKnownCompanyName("SDR | Teste")).toBe(false);
      expect(isValidKnownCompanyName("formulario-contato")).toBe(false);
      expect(isValidKnownCompanyName("ALPHA PET LTDA")).toBe(true);
    });

    it("não pede confirmação 'Sua empresa é a [Nome Pessoal], certo?' quando empresa = nome pessoal sem CNPJ", () => {
      expect(looksLikePersonalNameUsedAsCompany("Valdônio", "Valdônio")).toBe(true);
      expect(looksLikePersonalNameUsedAsCompany("ALPHA PET LTDA", "ALPHA PET LTDA")).toBe(false);

      const directivePersonal = buildKnownClientPromptDirective({
        knownClient: {
          companyName: "Valdônio",
          contactName: "Valdônio",
          document: null,
          source: "contact_company",
        },
        confirmationStatus: "pending",
        currentData: {},
      });
      expect(directivePersonal).toBe("");

      const directiveCorporate = buildKnownClientPromptDirective({
        knownClient: {
          companyName: "TECFAG COMERCIO E IMPORTACAO LTDA",
          contactName: "João",
          document: null,
          source: "crm_account",
        },
        confirmationStatus: "pending",
        currentData: {},
      });
      expect(directiveCorporate).toContain(
        "Sua empresa é a TECFAG COMERCIO E IMPORTACAO LTDA, certo?",
      );
    });
  });

  describe("4. Rodízio em awaiting_approval distribui pré-sugestões sem empilhar 5x na mesma vendedora", () => {
    it("alterna entre operadoras elegíveis considerando aprovações pendentes no mesmo tenant", () => {
      const sellers = [
        { id: "op-melissa", leadsReceivedCount: 5, compensation: 0 },
        { id: "op-evelyn", leadsReceivedCount: 5, compensation: 0 },
        { id: "op-pamela", leadsReceivedCount: 5, compensation: 0 },
        { id: "op-denise", leadsReceivedCount: 6, compensation: 0 },
      ];
      const pendingLoad = new Map<string, number>();
      const chosenOrder: string[] = [];

      for (let i = 0; i < 5; i++) {
        const next = sortIndustrialRodizioCandidatesWithPendingLoad(sellers, pendingLoad)[0];
        chosenOrder.push(next.id);
        pendingLoad.set(next.id, (pendingLoad.get(next.id) || 0) + 1);
      }

      // 4 leads distintos antes de repetir alguém — nunca 5x Melissa Gomes!
      expect(new Set(chosenOrder.slice(0, 4)).size).toBe(4);
      expect(chosenOrder.filter((id) => id === "op-melissa").length).toBeLessThanOrEqual(2);
    });
  });
});
