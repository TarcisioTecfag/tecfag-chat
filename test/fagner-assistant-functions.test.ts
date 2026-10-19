import { describe, it, expect } from "vitest";
import {
  expandPtBrAbbreviationsAndAccents,
  validateGrammarFidelity,
} from "../src/lib/valentina/grammar-corrector";
import {
  buildGrammarPrompt,
  formatMessageContentForAi,
  buildBestResponsePrompt,
  buildLeadSummaryPrompt,
  type ConversationRichContext,
} from "../src/lib/valentina/assistant-engine";
import { getAiPersona } from "../src/lib/ai-persona";

describe("Assistente Fagner — 3 Funções (Corretor Gramatical, Melhor Resposta e Resumo do Atendimento)", () => {
  describe("1. Corretor Gramatical (Ultra-Rápido, Expansão de Abreviações e Fidelidade Estrita)", () => {
    it("expande obrigatoriamente vc, pra, pro, mt, tb, pq, q, hj, agr, obg e corrige acentos técnicos", () => {
      const input =
        "oi joao, vc consegue me mandar o cnpj pra eu gerar o orcamento da maquina seladora continua a vacuo hj?";
      const output = expandPtBrAbbreviationsAndAccents(input);

      expect(output).toContain("você");
      expect(output).toContain("para");
      expect(output).toContain("CNPJ");
      expect(output).toContain("orçamento");
      expect(output).toContain("máquina");
      expect(output).toContain("seladora contínua");
      expect(output).toContain("vácuo");
      expect(output).toContain("hoje?");
      expect(output).not.toMatch(/\bvc\b/i);
      expect(output).not.toMatch(/\bpra\b/i);
      expect(output).not.toMatch(/\bhj\b/i);
    });

    it("diferencia 'pq' interrogativo ('Por que') de 'pq' explicativo ('porque') e expande 'n' e 'to'", () => {
      const question = "pq a maquina n funciona qdo liga no 220V?";
      const fixedQuestion = expandPtBrAbbreviationsAndAccents(question);
      expect(fixedQuestion).toBe("Por que a máquina não funciona quando liga no 220V?");

      const explanation = "to vendo aqui pro cliente pq ele pediu video tb.";
      const fixedExplanation = expandPtBrAbbreviationsAndAccents(explanation);
      expect(fixedExplanation).toBe(
        "Estou vendo aqui para o cliente porque ele pediu vídeo também.",
      );
    });

    it("preserva URLs, e-mails e códigos de máquinas intactos", () => {
      const input =
        "vc pode ver o video da PCS200 em https://tecfag.com.br/maquina?vc=1&pra=2 ou mandar pro email comercial@tecfag.com.br";
      const output = expandPtBrAbbreviationsAndAccents(input);

      expect(output).toContain("https://tecfag.com.br/maquina?vc=1&pra=2");
      expect(output).toContain("comercial@tecfag.com.br");
      expect(output).toContain("PCS200");
      expect(output).toContain("Você pode ver o vídeo");
      expect(output).toContain("para o email");
    });

    it("validateGrammarFidelity aceita correções legítimas de concordância e pontuação sem reescrita", () => {
      const preExpanded =
        "Você consegue me mandar as informações das máquinas para fazermos os orçamentos hoje?";
      const aiCorrected =
        "Você consegue me mandar as informações das máquinas para fazermos os orçamentos hoje?";

      expect(validateGrammarFidelity(preExpanded, aiCorrected)).toEqual({ valid: true });
    });

    it("validateGrammarFidelity bloqueia quando a IA tenta mudar completamente o texto, adicionar saudação ou responder à pergunta", () => {
      const preExpanded = "Você tem o CNPJ para eu gerar o orçamento da seladora?";

      // Caso 1: IA responde à pergunta em vez de corrigir
      const aiAnsweredInstead =
        "Sim, claro! Assim que você nos informar os dados da empresa faremos a emissão da proposta comercial.";
      expect(validateGrammarFidelity(preExpanded, aiAnsweredInstead).valid).toBe(false);

      // Caso 2: IA inventa saudação corporativa que não existia no rascunho
      const aiAddedGreeting =
        "Olá, bom dia! Tudo bem? Gostaria de saber se você possui o CNPJ para gerarmos o orçamento da seladora.";
      expect(validateGrammarFidelity(preExpanded, aiAddedGreeting).valid).toBe(false);

      // Caso 3: Prompt de gramática instrui explicitamente preservação 1:1
      const prompt = buildGrammarPrompt(preExpanded);
      expect(prompt).toContain("<rascunho>");
      expect(prompt).toContain("PROIBIDO REESCREVER OU ALTERAR O SENTIDO");
    });
  });

  describe("2. Melhor Resposta (Identidade Industrial Grupo Tecfag, Contexto Real e Mídia)", () => {
    it("define a persona do tenant tecfag como Grupo Tecfag (Máquinas Industriais) e nunca como informática/TI", () => {
      const persona = getAiPersona("tecfag");
      expect(persona.name).toBe("Fagner");
      expect(persona.company).toBe("Grupo Tecfag");
      expect(persona.segment).toContain("máquinas industriais");
      expect(persona.segment).toContain("seladoras");
      expect(persona.segment).not.toContain("informática");
    });

    it("formata mensagens de mídia com transcrição/interpretação sem expor tags cruas [AUDIO:...] ou [IMAGE:...]", () => {
      const formatted = formatMessageContentForAi(
        "[AUDIO:/api/media/abc-123.ogg]",
        "Cliente diz que precisa embalar 500 pacotes de café de 500g por hora",
      );
      expect(formatted).toContain("[🎵 Áudio enviado]");
      expect(formatted).toContain("500 pacotes de café");
      expect(formatted).not.toContain("/api/media/");
    });

    it("gera prompt de Melhor Resposta contextualizado com CRM, última pergunta do cliente e regras do Grupo Tecfag", async () => {
      const mockContext: ConversationRichContext = {
        visibleTranscript:
          "[08:40] Cliente: Bom dia, preciso de uma seladora a vácuo para carne temperada em pacotes de 1kg.\n[08:41] Consultor (Carlos): Bom dia! Qual a sua produção por hora?\n[08:42] Cliente: Cerca de 200 pacotes por hora, vocês têm a pronta entrega em 220V?",
        internalNotesTranscript: "[Nota Interna - SDR]: Cliente possui CNPJ ativo em SP.",
        lastClientMessagesText:
          "Cerca de 200 pacotes por hora, vocês têm a pronta entrega em 220V?",
        lastSpeaker: "client",
        crmAndContactContext:
          '👤 CONTATO: Nome: Frigorífico Silva | CNPJ: 12.345.678/0001-90\n💼 NEGOCIAÇÃO CRM: "Seladora a Vácuo DZ400" | Funil: Máquinas → Etapa: Qualificação',
        knowledgeQueryHint: "seladora a vacuo 200 pacotes por hora 220V",
      };

      const prompt = await buildBestResponsePrompt({
        tenantId: "tecfag",
        operatorName: "Carlos",
        contactName: "Frigorífico Silva",
        currentDraftText: "",
        richContext: mockContext,
      });

      expect(prompt).toContain("GRUPO TECFAG");
      expect(prompt).toContain("Seladora a Vácuo DZ400");
      expect(prompt).toContain("Cerca de 200 pacotes por hora, vocês têm a pronta entrega em 220V?");
      expect(prompt).toContain("PROIBIDO RESPOSTA GENÉRICA");
      expect(prompt).not.toContain("computadores corporativos");
      expect(prompt).not.toContain("servidores");
    });
  });

  describe("3. Resumo do Atendimento (Síntese Completa e Fiel para Anotação Interna)", () => {
    it("constrói prompt de Resumo do Atendimento com os 6 tópicos técnicos/comerciais do Grupo Tecfag e trava anti-alucinação", () => {
      const mockContext: ConversationRichContext = {
        visibleTranscript:
          "[09:00] Cliente: Olá, quero cotar um datador inkjet para potes plásticos de suplemento.\n[09:02] Consultor (Marcos): Olá! Quantos potes por minuto você pretende datar?",
        internalNotesTranscript: "",
        lastClientMessagesText: "",
        lastSpeaker: "consultant",
        crmAndContactContext: "👤 CONTATO: Nome: NutriLab Suplementos | Tel: +5511999999999",
        knowledgeQueryHint: "datador inkjet potes suplemento",
      };

      const prompt = buildLeadSummaryPrompt({
        tenantId: "tecfag",
        contactName: "NutriLab Suplementos",
        richContext: mockContext,
      });

      expect(prompt).toContain("📋 RESUMO DO ATENDIMENTO — GRUPO TECFAG");
      expect(prompt).toContain("• Cliente / Empresa:");
      expect(prompt).toContain("• Equipamento / Peça de Interesse:");
      expect(prompt).toContain("• Aplicação & Produção:");
      expect(prompt).toContain("• O que já foi tratado:");
      expect(prompt).toContain("• Situação Atual:");
      expect(prompt).toContain("• Próximo Passo Recomendado:");
      expect(prompt).toContain("Ainda não informado na conversa");
    });
  });
});
