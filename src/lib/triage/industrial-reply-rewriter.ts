import { z } from "zod";
import { vertexAi } from "../vertex-ai.ts";
import type { AiPersona } from "../ai-persona.ts";
import {
  INDUSTRIAL_FALSE_SYSTEM_CLAIM_PATTERN,
  isPrematureIndustrialHandoffBubble,
  stripLeadingOrphanAnaphoricConnector,
} from "./industrial-handoff.ts";
import {
  INDUSTRIAL_CURRICULUM_SOLIDES_URL,
  INDUSTRIAL_SUPPLIERS_EMAIL,
  type CollectedFields,
  type RequiredField,
} from "./industrial-policy.ts";

export type IndustrialReplyRewriteMode =
  | "collecting_missing_fields"
  | "awaiting_approval"
  | "resolved"
  | "direct_operator_absent"
  | "direct_operator_offer"
  | "direct_operator_not_found"
  | "direct_operator_homonym";

export interface RewriteIndustrialReplyInput {
  tenantId: string;
  conversationId: string;
  aiPersona: AiPersona;
  rewriteMode: IndustrialReplyRewriteMode;
  subflow?: string | null;
  conversationHistoryText: string;
  batchSummary: string;
  collectedData: CollectedFields;
  missingFields?: readonly RequiredField[];
  knownCompanyToConfirm?: string | null;
  safeBubbles?: readonly string[];
  originalMessages?: readonly string[];
  directOperatorContext?: {
    citedName?: string | null;
    operatorName?: string | null;
    homonymNames?: readonly string[];
  };
  signal?: AbortSignal;
}

export interface RewriteIndustrialReplyOutput {
  messagesToSend: string[];
  shouldEscalateToReview: boolean;
}

const MISSING_FIELD_LABELS: Record<RequiredField, string> = {
  name: "nome completo da pessoa",
  document: "CNPJ ou CPF (ou confirmação da empresa cadastrada)",
  request: "qual equipamento, peça ou demanda o cliente precisa",
  application: "qual produto/aplicação vai processar ou embalar",
  production: "produtividade ou volume aproximado (ex.: unidades/pacotes por hora ou dia)",
};

const rewriteResponseSchema = z.object({
  messagesToSend: z
    .unknown()
    .transform((raw) => {
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
      return list
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 1200))
        .filter((item) => item.length > 0)
        .slice(0, 3);
    }),
  shouldEscalateToReview: z
    .unknown()
    .optional()
    .transform((v) => v === true || v === "true"),
});

const CONSULTATIVE_FIELD_PRIORITY: readonly RequiredField[] = [
  "request",
  "application",
  "production",
  "name",
  "document",
];

export function prioritizeMissingFieldsForConversation(
  missingFields: readonly RequiredField[],
): RequiredField[] {
  const unique = [...new Set(missingFields)];
  return unique.sort((a, b) => {
    const idxA = CONSULTATIVE_FIELD_PRIORITY.indexOf(a);
    const idxB = CONSULTATIVE_FIELD_PRIORITY.indexOf(b);
    const rankA = idxA === -1 ? CONSULTATIVE_FIELD_PRIORITY.length : idxA;
    const rankB = idxB === -1 ? CONSULTATIVE_FIELD_PRIORITY.length : idxB;
    return rankA - rankB;
  });
}

export function buildIndustrialReplyRewritePrompt(input: RewriteIndustrialReplyInput): string {
  const orderedMissingFields = prioritizeMissingFieldsForConversation(input.missingFields || []);
  const missingLabels = orderedMissingFields.map((field) => {
    if (field === "document" && input.knownCompanyToConfirm?.trim()) {
      return `confirmar se a empresa é "${input.knownCompanyToConfirm.trim()}" (ou informar o CNPJ/CPF caso seja outra)`;
    }
    return MISSING_FIELD_LABELS[field] || field;
  });

  const collectedSummary: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.collectedData || {})) {
    if (k.startsWith("_")) continue;
    if (v?.status === "filled" && typeof v.value === "string" && v.value.trim()) {
      collectedSummary[k] = v.value.trim();
    }
  }

  const safeBubblesBlock =
    input.safeBubbles && input.safeBubbles.length > 0
      ? `BALÕES JÁ APROVADOS (NÃO repita o conteúdo deles se já for mantido, ou incorpore naturalmente para responder em 1 a 2 balões fluidos):\n${input.safeBubbles.map((b, i) => `${i + 1}. ${b}`).join("\n")}\n`
      : "";

  let objectiveBlock = "";
  switch (input.rewriteMode) {
    case "collecting_missing_fields":
      objectiveBlock = `OBJETIVO DESTE TURNO (COLETA EM ANDAMENTO):
- A resposta anterior prometeu encaminhamento/transferência antes da hora ou deixou conector solto enquanto ainda faltam dados: ${missingLabels.join("; ") || "esclarecer a necessidade do cliente"}.
- PRIMEIRO avalie se o cliente está claramente resistindo ao questionário, dizendo que os dados JÁ CONSTAM em uma proposta/orçamento/cadastro existente, insistindo em falar apenas com o consultor/equipe, ou insistindo que precisa apenas de uma especificação técnica objetiva ausente no contexto (ex.: torque em kgf·cm/N·m, dimensão exata, tensão, pressão) e resistindo a responder o questionário de qualificação:
  * Se SIM: defina \`shouldEscalateToReview: true\`, NÃO insista em perguntar o dado faltante e escreva 1 a 2 balões curtos, educados e naturais confirmando que vai direcionar para a equipe dar continuidade.
  * Se NÃO: defina \`shouldEscalateToReview: false\` e escreva 1 a 2 balões curtos, naturais e contextualizados ao histórico pedindo APENAS o próximo dado faltante (${missingLabels[0] || "o detalhe pendente"}).
- NUNCA comece um balão com conectores órfãos como "Enquanto isso...", "Nesse meio tempo..." ou "Além disso...". Se os balões já aprovados estiverem falando de aplicação/especificação técnica do produto, NUNCA cole uma pergunta abrupta de CNPJ/CPF no 2º balão — mantenha a conversa fluida no mesmo assunto.
- PROIBIDO quando \`shouldEscalateToReview: false\`: NÃO diga "já estou encaminhando", "já direcionei", "vou localizar e transferir" nem "em breve um especialista entrará em contato". Apenas responda com empatia/contexto e faça a pergunta pendente de forma humana.`;
      break;
    case "awaiting_approval":
      objectiveBlock = `OBJETIVO DESTE TURNO (TRIAGEM CONCLUÍDA — AGUARDANDO APROVAÇÃO INTERNA):
- Escreva 1 a 2 balões curtos, naturais e contextualizados ao assunto real do cliente confirmando que recebeu tudo e que a equipe responsável dará continuidade por aqui.
- PROIBIDO fazer novas perguntas (não use "?"), PROIBIDO dizer que já criou card no CRM ou transferiu para um nome específico de vendedor, e PROIBIDO usar "Perfeito, já coletei tudo! Estou validando".`;
      break;
    case "resolved":
      if (input.subflow === "5B_CURRICULO") {
        objectiveBlock = `OBJETIVO DESTE TURNO (ENVIO DE CURRÍCULO / VAGAS — ENCERRAMENTO INFORMATIVO):
- A pessoa quer enviar currículo ou saber sobre vagas.
- Explique com simpatia em 1 balão curto e natural que ela deve enviar o currículo pelo Sólides usando exatamente o link ${INDUSTRIAL_CURRICULUM_SOLIDES_URL}, assim o nosso RH pode analisar com calma e dar retorno para ela.
- OBRIGATÓRIO incluir exatamente o link ${INDUSTRIAL_CURRICULUM_SOLIDES_URL} no texto.
- PROIBIDO pedir CNPJ, CPF, nome completo ou outros dados, PROIBIDO fazer perguntas ("?") e PROIBIDO dizer que vai transferir pelo chat.`;
      } else if (input.subflow === "5C_COMPRAS") {
        objectiveBlock = `OBJETIVO DESTE TURNO (FORNECEDORES, PARCERIAS, TRANSPORTADORAS OU VENDA DE INSUMOS — ENCERRAMENTO INFORMATIVO):
- A pessoa quer oferecer produtos, propor parcerias, oferecer serviços de transportadora ou vender insumos.
- Explique gentilmente em 1 balão curto e natural que ela deve enviar a apresentação/proposta para o e-mail do nosso setor responsável por isso: ${INDUSTRIAL_SUPPLIERS_EMAIL}.
- OBRIGATÓRIO incluir exatamente o e-mail ${INDUSTRIAL_SUPPLIERS_EMAIL} no texto.
- PROIBIDO pedir CNPJ, CPF, nome completo ou outros dados, PROIBIDO fazer perguntas ("?") e PROIBIDO dizer que vai transferir pelo chat.`;
      } else {
        objectiveBlock = `OBJETIVO DESTE TURNO (ENCERRAMENTO LIMPO SEM TRANSFERÊNCIA):
- O cliente encerrou, desistiu, informou que já comprou ou tratou de assunto informativo (currículo/fornecedor).
- Escreva 1 balão curto, cordial e contextualizado encerrando o atendimento com educação.
- PROIBIDO prometer encaminhamento/transferência para equipe ou especialista e PROIBIDO pedir novos dados.`;
      }
      break;
    case "direct_operator_absent":
      objectiveBlock = `OBJETIVO DESTE TURNO (OPERADOR CITADO AUSENTE):
- O cliente pediu para falar com ${input.directOperatorContext?.operatorName || "o consultor"}, que está ausente no momento.
- Escreva 1 a 2 balões curtos e naturais avisando que ${input.directOperatorContext?.operatorName || "esse consultor"} está ausente agora e PERGUNTANDO se o cliente prefere falar com outro consultor da equipe agora ou aguardar o retorno.`;
      break;
    case "direct_operator_offer":
      objectiveBlock = `OBJETIVO DESTE TURNO (OFERECER TRANSFERÊNCIA NOMINAL):
- O cliente mencionou que estava conversando com ${input.directOperatorContext?.operatorName || "um consultor"}.
- Escreva 1 balão curto e natural perguntando se gostaria de ser transferido para ${input.directOperatorContext?.operatorName || "esse consultor"} continuar de onde pararam (sem fazer questionário de triagem).`;
      break;
    case "direct_operator_not_found":
      objectiveBlock = `OBJETIVO DESTE TURNO (NOME CITADO NÃO LOCALIZADO — PARADA SEGURA):
- O cliente pediu para falar com "${input.directOperatorContext?.citedName || "essa pessoa"}", mas esse nome não consta na lista de operadores ativos.
- Escreva 1 balão curto, simpático e natural avisando que não localizou esse nome diretamente aqui, mas que já está acionando a equipe para localizar e encaminhar certinho.
- PROIBIDO fazer perguntas (não use "?") e PROIBIDO dizer "já estou transferindo para ${input.directOperatorContext?.citedName || "essa pessoa"}".`;
      break;
    case "direct_operator_homonym":
      objectiveBlock = `OBJETIVO DESTE TURNO (DESAMBIGUAÇÃO DE HOMÔNIMOS):
- Há mais de uma pessoa com o nome citado na equipe: ${(input.directOperatorContext?.homonymNames || []).join(", ") || "mais de um atendente"}.
- Escreva 1 a 2 balões curtos e naturais perguntando com qual deles o cliente gostaria de falar.`;
      break;
  }

  return `Você é ${input.aiPersona.name}, assistente virtual de ${input.aiPersona.company}. Tom: ${input.aiPersona.tone}.
Escreva respostas 100% naturais, curtas e humanas em português (estilo WhatsApp profissional, sem clichês robóticos, sem repetir "Entendido, [Nome]." e sem se reapresentar).

${objectiveBlock}

DADOS JÁ COLETADOS:
${JSON.stringify(collectedSummary)}

${safeBubblesBlock}HISTÓRICO RECENTE:
${input.conversationHistoryText.slice(-2400)}

ÚLTIMA MENSAGEM DO CLIENTE:
${input.batchSummary.slice(-1000)}

Retorne EXCLUSIVAMENTE JSON válido:
{
  "messagesToSend": ["balão 1", "balão 2 opcional"],
  "shouldEscalateToReview": false
}`;
}

export function sanitizeRewrittenIndustrialMessages(
  rewriteMode: IndustrialReplyRewriteMode,
  rawMessages: readonly string[],
  shouldEscalateToReview: boolean,
  subflow?: string | null,
): string[] {
  const cleaned = rawMessages
    .map((m) => String(m || "").trim())
    .filter(Boolean);

  const isCurriculum = subflow === "5B_CURRICULO";
  const isSuppliers = subflow === "5C_COMPRAS";

  const sanitized =
    rewriteMode === "collecting_missing_fields" && !shouldEscalateToReview
      ? cleaned.filter((m) => !isPrematureIndustrialHandoffBubble(m))
      : rewriteMode === "awaiting_approval" || rewriteMode === "direct_operator_not_found"
        ? cleaned.filter(
            (m) => !m.includes("?") && !INDUSTRIAL_FALSE_SYSTEM_CLAIM_PATTERN.test(m),
          )
        : rewriteMode === "resolved"
          ? cleaned.filter((m) => {
              if (INDUSTRIAL_FALSE_SYSTEM_CLAIM_PATTERN.test(m)) return false;
              if (isCurriculum && /grupotecfag\.vagas\.solides\.com\.br/i.test(m)) return true;
              if (isSuppliers && /adm@tecfag\.com\.br/i.test(m)) return true;
              return !isPrematureIndustrialHandoffBubble(m);
            })
          : cleaned;

  if (
    sanitized.length > 0 &&
    /^(?:enquanto\s+isso|nesse\s+meio\s+tempo)[,:\-–—\s]+/i.test(sanitized[0])
  ) {
    const [first, ...rest] = sanitized;
    return [stripLeadingOrphanAnaphoricConnector(first), ...rest];
  }
  return sanitized;
}

/**
 * Reescrita contextual 100% via Google Vertex AI (Gemini 2.5 Flash) — substitui
 * definitivamente qualquer fallback de texto pronto/robótico na triagem do Fagner.
 */
export async function rewriteIndustrialReplyWithGemini(
  input: RewriteIndustrialReplyInput,
): Promise<RewriteIndustrialReplyOutput | null> {
  if (!vertexAi.isReady()) return null;

  try {
    const prompt = buildIndustrialReplyRewritePrompt(input);
    const raw = await vertexAi.generateStructuredJson<unknown>(
      prompt,
      "gemini-2.5-flash",
      input.signal,
      {
        tenantId: input.tenantId,
        feature: "sdr_agent",
        generationConfig: {
          thinkingBudget: 0,
        },
        metadata: {
          conversationId: input.conversationId,
          rewriteMode: input.rewriteMode,
        },
      },
    );

    const parsed = rewriteResponseSchema.safeParse(raw);
    if (!parsed.success || parsed.data.messagesToSend.length === 0) {
      return null;
    }

    const shouldEscalate =
      input.rewriteMode === "collecting_missing_fields" && parsed.data.shouldEscalateToReview;
    const sanitized = sanitizeRewrittenIndustrialMessages(
      input.rewriteMode,
      parsed.data.messagesToSend,
      shouldEscalate,
      input.subflow,
    );

    if (sanitized.length === 0) return null;

    return {
      messagesToSend: sanitized,
      shouldEscalateToReview: shouldEscalate,
    };
  } catch (err: any) {
    console.warn(
      `[IndustrialReplyRewriter] Falha ao reescrever resposta via Gemini (${input.rewriteMode}, conversa ${input.conversationId}):`,
      err?.message || err,
    );
    return null;
  }
}
