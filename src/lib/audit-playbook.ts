/**
 * PLAYBOOK DE VENDAS — VALEM CHAT
 *
 * Este arquivo define as regras de comportamento que a IA usa para auditar
 * os atendimentos. Quando o playbook real da Valem estiver pronto, substitua
 * as seções marcadas com [PERSONALIZAR] abaixo.
 *
 * O formato é texto puro para facilitar edição por não-técnicos.
 */

export const VALEM_PLAYBOOK = `
## SOBRE A EMPRESA
[PERSONALIZAR] A Valem é uma empresa de vendas B2B. Os operadores são consultores
comerciais que atendem clientes via WhatsApp, com foco em conversão e relacionamento.

## FLUXO IDEAL DE ATENDIMENTO
[PERSONALIZAR com o processo real da Valem]

1. BOAS-VINDAS (primeiros 30 segundos)
   - Cumprimentar o cliente pelo nome sempre que possível
   - Identificar-se pelo nome
   - Demonstrar que está disponível e atento

2. ENTENDIMENTO DA NECESSIDADE
   - Fazer perguntas abertas para entender a dor do cliente
   - Não oferecer produto/preço antes de entender o contexto
   - Mostrar interesse genuíno, não pressa

3. APRESENTAÇÃO DA SOLUÇÃO
   - Conectar o produto/serviço diretamente ao problema identificado
   - Usar linguagem clara, sem jargões excessivos
   - Dar exemplos concretos quando possível

4. GESTÃO DE OBJEÇÕES
   - Nunca ignorar uma objeção — sempre responder diretamente
   - Validar a preocupação do cliente antes de rebater
   - Oferecer alternativas quando não conseguir resolver a objeção principal

5. ENCERRAMENTO
   - Deixar um próximo passo claro (reunião, proposta, follow-up)
   - Confirmar dados de contato se necessário
   - Agradecer o contato de forma personalizada (não genérica)

## COMPORTAMENTOS QUE PENALIZAM O SCORE (máximo -15 pontos cada)
[PERSONALIZAR com os problemas reais identificados pela gestão]

❌ DEMORA EXCESSIVA: Demorar mais de 15 minutos para responder uma mensagem do cliente durante o expediente
❌ OBJEÇÃO IGNORADA: Cliente levanta uma dúvida ou preocupação e o operador não responde ou desvia do assunto
❌ SEM FOLLOW-UP: Atendimento termina sem combinação de próximo passo quando havia oportunidade
❌ LINGUAGEM INADEQUADA: Tom grosseiro, impaciente, irônico ou excessivamente informal (gírias exageradas)
❌ RESPOSTA GENÉRICA: Resposta de copiar/colar que não considera o contexto específico do cliente
❌ PRESSÃO EXCESSIVA: Insistir de forma agressiva após o cliente demonstrar desinteresse
❌ DESINFORMAÇÃO: Passar informação incorreta sobre produto, prazo ou preço
❌ ABANDONO: Parar de responder sem avisar o motivo (ex: "vou verificar e retorno")

## COMPORTAMENTOS QUE VALORIZAM O SCORE (máximo +10 pontos cada)
[PERSONALIZAR com os comportamentos exemplares observados]

✅ PERSONALIZAÇÃO: Usar o nome do cliente e referências ao contexto específico dele
✅ AGILIDADE: Responder em menos de 5 minutos demonstrando atenção
✅ EMPATIA: Validar a situação do cliente antes de apresentar solução
✅ CLAREZA: Mensagens objetivas, bem estruturadas, sem ambiguidade
✅ PROATIVIDADE: Antecipar dúvidas ou oferecer informação útil sem o cliente pedir
✅ ENCERRAMENTO FORTE: Combinação clara de próximo passo com data/hora definida
✅ RECUPERAÇÃO: Transformar um cliente frustrado em satisfeito durante o atendimento

## CRITÉRIO DE SENTIMENTO DO CLIENTE
- SATISFEITO: Cliente demonstra aprovação, agradece, confirma interesse, aceita proposta
- NEUTRO: Atendimento transacional sem sinais claros de satisfação ou frustração
- FRUSTRADO: Cliente demonstra impaciência, reclama, ameaça desistir, usa linguagem negativa

## IMPORTANTE PARA A IA
- Avalie o atendimento como um todo, não apenas mensagens isoladas
- Considere o contexto: clientes difíceis exigem mais habilidade
- Um score 70-100 = bom atendimento, 50-69 = médio, abaixo de 50 = crítico
- O "actionableInsight" deve ser UMA frase direta para o gestor agir HOJE
`;

export const AUDIT_JSON_SCHEMA = `
Responda APENAS com um objeto JSON válido, sem markdown, sem explicações, sem texto fora do JSON.

{
  "performanceScore": <número inteiro de 0 a 100>,
  "clientSentiment": "<satisfeito | neutro | frustrado>",
  "hadLongResponseGap": <true se houve gap > 15min, false caso contrário>,
  "hadMissedObjection": <true se cliente levantou objeção e foi ignorada>,
  "hadRudeLanguage": <true se houve linguagem inadequada>,
  "hadNoFollowUp": <true se não houve combinação de próximo passo quando deveria>,
  "summary": "<resumo do atendimento em 2-3 frases objetivas>",
  "strengths": "<o que o vendedor fez bem de forma específica, com referência ao que foi dito>",
  "weaknesses": "<o que o vendedor errou de forma específica, com referência ao que foi dito. Se não houver falhas, diga 'Nenhuma falha identificada'>",
  "actionableInsight": "<UMA frase direta para o gestor agir, ex: 'Cobrar X que ignorou a objeção sobre prazo de entrega'>"
}
`;
