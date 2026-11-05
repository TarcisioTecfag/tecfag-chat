import { getAiPersona } from "./ai-persona";

/**
 * PLAYBOOKS DE AUDITORIA DE ATENDIMENTO COMERCIAL POR TENANT
 *
 * Define os critérios de Quality Assurance (QA) comercial e técnico utilizados
 * pela IA (Vertex AI Gemini) para auditar conversas de cada empresa.
 */

export const TECFAG_PLAYBOOK = `
## SOBRE A EMPRESA AUDITADA
O **Grupo Tecfag** é referência nacional no fornecimento de **máquinas industriais de embalagem, envasadoras, dosadoras, seladoras, datadores, empacotadoras, encapsuladoras, contadoras, rotuladoras, projetos industriais da linha Personnalité, peças de reposição e assistência técnica**.
Os operadores avaliados são consultores técnico-comerciais B2B que atendem empresas e indústrias via WhatsApp com foco em diagnóstico produtivo, especificação correta do equipamento, demonstração técnica e fechamento de negócios.

## PILARES E FLUXO IDEAL DE ATENDIMENTO (GRUPO TECFAG)

1. AGILIDADE E ACOLHIMENTO EXECUTIVO (Pilar: Agilidade / SLA)
   - Atender prontamente (idealmente em até 5 minutos; tolerância máxima de SLA de 15 minutos em horário comercial).
   - Cumprimentar o cliente pelo nome, apresentar-se de forma profissional e aproveitar o contexto prévio da triagem (não repetir perguntas que o cliente já respondeu ao SDR/IA).

2. DIAGNÓSTICO TÉCNICO E QUALIFICAÇÃO PRODUTIVA (Pilar: Qualificação Técnica)
   - Compreender a aplicação real antes de recomendar máquina ou condição comercial:
     * Qual produto será embalado/envasado/selado/datado (líquido, pastoso, pó, grão, sólido, cápsula)?
     * Qual o tipo e dimensão da embalagem (pote, frasco, garrafa, sachê, pacote, blister)?
     * Qual o volume de produção atual ou desejado (unidades/hora, unidades/dia ou mês) e tensão elétrica (110V/220V)?
   - Enquadrar corretamente a solução entre **Linha Semi-Industrial / Máquinas** e **Linha Personnalité (alta produtividade / automação)**.

3. APRESENTAÇÃO TÉCNICO-COMERCIAL E VALOR (Pilar: Qualificação & Clareza)
   - Explicar de forma clara e consultiva como a máquina resolve o gargalo produtivo do cliente.
   - Utilizar materiais de apoio quando pertinente (vídeos da máquina operando, fotos, ficha técnica, proposta formal).
   - Respeitar rigorosamente a política comercial da Tecfag (apresentar condições oficiais de pagamento como PIX, parcelamento e entrada + saldo com clareza e segurança).

4. CONTORNO DE OBJEÇÕES (Pilar: Gestão de Objeções)
   - Nunca ignorar dúvidas ou objeções do cliente (preço, prazo de entrega, frete, garantia, assistência técnica, peças de reposição, diferença entre modelos).
   - Validar a preocupação do cliente com argumentos técnicos (retorno sobre investimento, produtividade por hora, robustez em inox, suporte técnico nacional da Tecfag).

5. FECHAMENTO E PRÓXIMO PASSO CLARO (Pilar: Fechamento & Follow-up)
   - Todo atendimento comercial deve terminar com um próximo passo concreto e datado (envio de orçamento formal, ligação técnica, validação de vídeo/amostra, retorno agendado após análise da diretoria/sócio).
   - Confirmar CNPJ/dados para cotação quando aplicável e manter compromisso ativo de acompanhamento.

## COMPORTAMENTOS QUE PENALIZAM O SCORE
- DEMORA EXCESSIVA (SLA > 15 min): Deixar o cliente esperando mais de 15 minutos sem retorno ou justificativa durante o atendimento.
- OBJEÇÃO OU PERGUNTA IGNORADA: O cliente faz uma pergunta técnica/comercial ou levanta uma objeção e o consultor ignora, responde pela metade ou muda de assunto.
- FALTA DE SONDAGEM TÉCNICA: Empurrar máquina ou preço sem entender o produto, embalagem ou necessidade mínima do cliente.
- SEM FOLLOW-UP / PRÓXIMO PASSO: Encerrar ou deixar a conversa morrer sem combinar uma ação clara de continuidade quando havia oportunidade comercial.
- POSTURA OU LINGUAGEM INADEQUADA: Tom ríspido, impaciente, irônico, desatento ou excessivamente informal para uma negociação B2B industrial.
- REPETIÇÃO DESNECESSÁRIA DE TRIAGEM: Perguntar tudo novamente o que o cliente já havia acabado de informar nas mensagens anteriores da conversa.

## COMPORTAMENTOS QUE VALORIZAM O SCORE
- Personalização pelo nome do cliente e leitura atenta do histórico/triagem anterior.
- Agilidade de resposta (< 5 min) e envio de áudios/mensagens claras e bem estruturadas.
- Domínio técnico sobre o portfólio de máquinas Tecfag e orientação consultiva segura.
- Contorno inteligente de objeções conectando o investimento ao ganho de produção e padronização da embalagem.
- Definição explícita de próximo passo com data/horário ou chamada para ação clara.
`;

export const VALEM_PLAYBOOK = `
## SOBRE A EMPRESA AUDITADA
A **Valem Válvulas e Embalagens** é uma empresa B2B especialista no fornecimento de **válvulas aerosol e spray, frascos, potes, tampas, seladoras, embaladoras e soluções completas de embalagem**.
Os operadores avaliados são consultores comerciais que atendem clientes B2B via WhatsApp, com foco em especificação técnica da embalagem/válvula, cotação ágil por volume/milheiro, conversão de vendas e recorrência.

## PILARES E FLUXO IDEAL DE ATENDIMENTO (VALEM)

1. BOAS-VINDAS E AGILIDADE (Pilar: Agilidade / SLA)
   - Cumprimentar o cliente pelo nome, identificar-se com cordialidade e responder dentro do SLA (< 15 minutos, idealmente < 5 minutos).
   - Aproveitar as informações já coletadas na triagem inicial sem obrigar o cliente a repetir tudo.

2. ENTENDIMENTO DA NECESSIDADE E ESPECIFICAÇÃO (Pilar: Qualificação Técnica)
   - Identificar qual produto será envasado, tipo de frasco/pote/válvula (rosca, pescante, vazão, material PET/PEAD/vidro) e quantidade pretendida (lote/milheiro).
   - Não enviar cotação cega sem entender o contexto de uso do cliente.

3. APRESENTAÇÃO DA SOLUÇÃO E CONDIÇÕES (Pilar: Qualificação & Clareza)
   - Conectar o item do catálogo diretamente à necessidade do cliente, oferecendo alternativas compatíveis quando necessário.
   - Apresentar condições comerciais, prazos e disponibilidade de estoque com transparência e objetividade.

4. GESTÃO DE OBJEÇÕES (Pilar: Gestão de Objeções)
   - Responder diretamente a toda dúvida ou objeção de preço, lote mínimo, frete ou prazo.
   - Argumentar com base em qualidade de vedação, padronização, pronta-entrega e custo-benefício por unidade.

5. ENCERRAMENTO E PRÓXIMO PASSO (Pilar: Fechamento & Follow-up)
   - Deixar um próximo passo claro (envio de orçamento formal, envio de amostras, confirmação de CNPJ/frete ou data de follow-up).
   - Agradecer o contato de forma profissional e consultiva.

## COMPORTAMENTOS QUE PENALIZAM O SCORE
- DEMORA EXCESSIVA: Demorar mais de 15 minutos para responder uma mensagem do cliente durante o expediente.
- OBJEÇÃO IGNORADA: Cliente levanta dúvida ou objeção e o operador não responde ou desvia do assunto.
- SEM FOLLOW-UP: Atendimento termina sem combinação de próximo passo quando havia oportunidade comercial.
- LINGUAGEM INADEQUADA: Tom grosseiro, impaciente, irônico ou desinteressado.
- RESPOSTA GENÉRICA OU DESINFORMAÇÃO: Resposta automática que ignora o contexto do cliente ou informação imprecisa.

## COMPORTAMENTOS QUE VALORIZAM O SCORE
- Personalização pelo nome do cliente e referência direta ao negócio dele.
- Resposta ágil (< 5 minutos), empática e bem estruturada.
- Proatividade em sugerir complementos (ex: frasco + válvula/tampa compatível) ou condições por volume.
- Encerramento forte com próximo passo claro e combinado.
`;

export function getAuditPlaybook(tenantId: string): string {
  if (tenantId === "tecfag") {
    return TECFAG_PLAYBOOK;
  }
  if (tenantId === "valem") {
    return VALEM_PLAYBOOK;
  }
  const persona = getAiPersona(tenantId);
  return `
## SOBRE A EMPRESA AUDITADA
Empresa: **${persona.company}** (Segmento: ${persona.segment}).
${TECFAG_PLAYBOOK}
`;
}

export const AUDIT_JSON_SCHEMA = `
## CRITÉRIOS DE PONTUAÇÃO E SENTIMENTO
- Avalie o atendimento de forma justa e analítica (0 a 100), considerando tanto a postura técnica/comercial do consultor quanto o contexto do cliente.
- Faixas de Score Geral:
  * 80 a 100 = Excelente (atendimento consultivo exemplar, ágil e direcionado ao fechamento)
  * 60 a 79  = Regular / Atenção (atendeu, mas deixou lacunas de sondagem, tempo de resposta ou próximo passo)
  * 0 a 59   = Crítico (falhas graves de SLA, objeção ignorada, abandono ou cliente frustrado)
- Critério de Sentimento do Cliente ("clientSentiment"):
  * "satisfeito": Cliente demonstra aprovação, agradece, avança na negociação ou confirma interesse.
  * "neutro": Interação objetiva/transacional sem sinais claros de entusiasmo ou insatisfação.
  * "frustrado": Cliente demonstra impaciência, reclama de demora/atendimento, contesta sem retorno ou desiste por falha de condução.

Responda APENAS com um objeto JSON válido, sem markdown, sem explicações fora do JSON:

{
  "performanceScore": <número inteiro de 0 a 100>,
  "clientSentiment": "<satisfeito | neutro | frustrado>",
  "hadLongResponseGap": <true se houve demora relevante > 15min sem justificativa, false caso contrário>,
  "hadMissedObjection": <true se o cliente fez pergunta/objeção que foi ignorada ou mal respondida>,
  "hadRudeLanguage": <true se houve linguagem ríspida, inadequada ou desatenta>,
  "hadNoFollowUp": <true se o atendimento parou/encerrou sem definição clara de próximo passo quando cabia>,
  "pillarScores": {
    "agility": <número inteiro de 0 a 100 avaliando tempo de resposta e prontidão>,
    "qualification": <número inteiro de 0 a 100 avaliando sondagem técnica e clareza na apresentação>,
    "objectionHandling": <número inteiro de 0 a 100 avaliando respostas às dúvidas e contorno de objeções>,
    "closingNextStep": <número inteiro de 0 a 100 avaliando condução para fechamento e definição de follow-up>
  },
  "detectedStage": "<abordagem | qualificacao | apresentacao | negociacao | fechamento | pos_venda>",
  "commercialRiskLevel": "<baixo | medio | alto | critico>",
  "summary": "<resumo executivo do atendimento em 2 a 3 frases objetivas dizendo o que o cliente buscava, como o consultor conduziu e em que pé parou>",
  "strengths": "<o que o consultor fez bem de forma específica, citando trechos ou atitudes reais da conversa>",
  "weaknesses": "<o que o consultor deixou a desejar de forma específica, citando o momento ou lacuna real. Se não houver falhas, escreva 'Nenhuma falha relevante identificada na condução deste atendimento.'>",
  "actionableInsight": "<UMA recomendação executiva direta para a Diretoria/Gestor agir hoje sobre este atendimento ou consultor>",
  "coachingMessageSuggestion": "<mensagem curta e construtiva em 1ª pessoa (1 a 2 frases) pronta para o gestor enviar ao consultor via Sussurro Interno orientando a ação prática neste atendimento>"
}
`;
