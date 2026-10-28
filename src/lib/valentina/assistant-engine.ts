import { db } from "../../db";
import {
  conversations,
  messages,
  contacts,
  crmAccounts,
  crmConversationDeals,
  crmDeals,
  crmPipelines,
  crmStages,
  crmDealProducts,
  crmDealActivities,
  crmCustomFieldDefinitions,
  agentFlowStates,
} from "../../db/schema";
import { eq, and, desc, isNull, asc, inArray, sql } from "drizzle-orm";
import type { AuthSessionContext } from "../auth-session";
import { conversationReadCondition } from "../access-control/conversation-access";
import { getAllowedPipelineIds } from "../rbac";
import { getAiPersona } from "../ai-persona";
import { getKnowledgeBaseContext } from "./knowledge-service";
import {
  formatCustomFieldLabel,
  isFilled,
  parseJsonArray,
} from "../crm/custom-fields";

export {
  expandPtBrAbbreviationsAndAccents,
  validateGrammarFidelity,
} from "./grammar-corrector";

export function buildGrammarPrompt(preExpandedDraft: string): string {
  return `Você é um corretor ortográfico e gramatical estrito de Língua Portuguesa (Brasil).
Sua ÚNICA tarefa é revisar a ortografia, acentuação, pontuação e concordância verbal/nominal do texto dentro de <rascunho>.

<rascunho>
${preExpandedDraft}
</rascunho>

REGRAS INVIOLÁVEIS (PROIBIDO REESCREVER OU ALTERAR O SENTIDO):
1. NÃO mude o estilo, NÃO troque palavras corretas por sinônimos e NÃO reescreva a estrutura da frase.
2. NÃO adicione saudações ("Olá", "Bom dia", "Tudo bem?"), despedidas ou informações que não estão em <rascunho>.
3. Se o texto em <rascunho> for uma pergunta, NÃO responda à pergunta — apenas corrija a escrita da pergunta mantendo o ponto de interrogação.
4. NUNCA use abreviações como "vc", "vcs", "pra", "pro", "mt", "tb", "tbm", "pq", "q", "obg", "blz", "hj", "agr" — mantenha sempre por extenso ("você", "para", "para o", "muito", "também", "porque"/"por que", "que", "obrigado", "beleza", "hoje", "agora").
5. Preserve códigos de máquinas (ex: PCS200, DZ400, 220V), números, siglas (CNPJ, CPF, CEP, NF) e emojis.
6. Retorne EXCLUSIVAMENTE o texto corrigido, sem aspas ao redor e sem nenhum comentário.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FORMATAÇÃO LIMPA DE MENSAGENS & CARREGAMENTO DE CONTEXTO RICO (DB + CRM)
// ═══════════════════════════════════════════════════════════════════════════════

export function formatMessageContentForAi(
  rawContent: string | null | undefined,
  mediaInterpretation?: string | null,
): string {
  let text = (rawContent || "").trim();

  text = text
    .replace(/\[IMAGE:[^\]]+\]/gi, "[📷 Imagem enviada]")
    .replace(/\[AUDIO:[^\]]+\]/gi, "[🎵 Áudio enviado]")
    .replace(/\[VIDEO:[^\]]+\]/gi, "[🎬 Vídeo enviado]")
    .replace(/\[DOCUMENT:[^\]|]+(?:\|([^\]]+))?\]/gi, (_, fileName) =>
      fileName ? `[📄 Documento: ${fileName}]` : "[📄 Documento enviado]",
    )
    .replace(/\[SEND_IMAGE:[^\]]+\]/gi, "[📷 Foto do catálogo enviada]")
    .trim();

  if (mediaInterpretation && mediaInterpretation.trim()) {
    const cleanInterp = mediaInterpretation.trim().slice(0, 400);
    text = text ? `${text} (Conteúdo da mídia: ${cleanInterp})` : `[Mídia]: ${cleanInterp}`;
  }

  return text;
}

export interface ConversationRichContext {
  visibleTranscript: string;
  internalNotesTranscript: string;
  lastClientMessagesText: string;
  lastSpeaker: "client" | "consultant" | "none";
  crmAndContactContext: string;
  knowledgeQueryHint: string;
}

export async function loadConversationRichContext(params: {
  session: AuthSessionContext;
  conversationId?: string;
  clientMessages?: any[];
  contactName?: string;
  maxMessages?: number;
}): Promise<ConversationRichContext> {
  const {
    session,
    conversationId,
    clientMessages = [],
    contactName = "",
    maxMessages = 30,
  } = params;
  const tenantId = session.tenantId;
  const canReadCrm = session.permissions?.views?.crm === true &&
    (session.operator.role === "admin" || session.permissions?.crm?.canViewCrm === true);
  const allowedPipelines = getAllowedPipelineIds(session);

  let normalizedMsgs: Array<{
    role: "client" | "consultant" | "internal" | "system";
    author: string;
    text: string;
    time?: string;
  }> = [];

  const crmLines: string[] = [];

  // 1. Consulta banco se houver conversationId real do cliente
  if (conversationId && conversationId !== "valentina") {
    try {
      const [convRow] = await db
        .select({
          convId: conversations.id,
          queueState: conversations.queueState,
          contactId: contacts.id,
          contactName: contacts.name,
          contactPhone: contacts.phone,
          contactEmail: contacts.email,
          contactCnpj: contacts.cnpj,
          contactCpf: contacts.cpf,
          contactTags: contacts.tags,
          accountId: contacts.accountId,
        })
        .from(conversations)
        .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)))
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.tenantId, tenantId),
            conversationReadCondition(session),
          ),
        )
        .limit(1);

      if (convRow) {
        const contactParts: string[] = [
          `Nome: ${convRow.contactName || contactName || "Cliente"}`,
        ];
        if (convRow.contactPhone) contactParts.push(`Tel: ${convRow.contactPhone}`);
        if (convRow.contactCnpj) contactParts.push(`CNPJ: ${convRow.contactCnpj}`);
        if (convRow.contactCpf) contactParts.push(`CPF: ${convRow.contactCpf}`);
        if (convRow.contactEmail) contactParts.push(`Email: ${convRow.contactEmail}`);
        if (Array.isArray(convRow.contactTags) && convRow.contactTags.length > 0) {
          contactParts.push(`Tags: ${convRow.contactTags.join(", ")}`);
        }
        crmLines.push(`👤 CONTATO: ${contactParts.join(" | ")}`);

        // Executa em paralelo: mensagens do banco, conta compradora, deals vinculados e triagem SDR
        const [dbMsgs, accountRows, linkedDeals, sdrStates] = await Promise.all([
          db
            .select({
              content: messages.content,
              senderType: messages.senderType,
              senderName: messages.senderName,
              isInternalNote: messages.isInternalNote,
              mediaInterpretation: messages.mediaInterpretation,
              sentAt: messages.sentAt,
            })
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.conversationId, conversationId),
              ),
            )
            .orderBy(desc(messages.sentAt))
            .limit(maxMessages),

          canReadCrm && convRow.accountId
            ? db
                .select({
                  name: crmAccounts.name,
                  tradeName: crmAccounts.tradeName,
                  document: crmAccounts.document,
                  documentType: crmAccounts.documentType,
                  segment: crmAccounts.segment,
                  address: crmAccounts.address,
                })
                .from(crmAccounts)
                .where(
                  and(
                    eq(crmAccounts.tenantId, tenantId),
                    eq(crmAccounts.id, convRow.accountId),
                  ),
                )
                .limit(1)
            : Promise.resolve([]),

          db
            .select({
              dealId: crmDeals.id,
              title: crmDeals.title,
              status: crmDeals.status,
              value: crmDeals.value,
              pipelineName: crmPipelines.name,
              stageName: crmStages.name,
              rating: crmDeals.rating,
              expectedCloseDate: crmDeals.expectedCloseDate,
              customFields: crmDeals.customFields,
            })
            .from(crmConversationDeals)
            .innerJoin(
              crmDeals,
              and(
                eq(crmDeals.id, crmConversationDeals.dealId),
                eq(crmDeals.tenantId, tenantId),
              ),
            )
            .leftJoin(
              crmPipelines,
              and(
                eq(crmPipelines.id, crmDeals.pipelineId),
                eq(crmPipelines.tenantId, tenantId),
              ),
            )
            .leftJoin(
              crmStages,
              and(
                eq(crmStages.id, crmDeals.stageId),
                eq(crmStages.tenantId, tenantId),
              ),
            )
            .where(
              and(
                eq(crmConversationDeals.tenantId, tenantId),
                eq(crmConversationDeals.conversationId, conversationId),
                eq(crmConversationDeals.isActive, true),
                canReadCrm ? undefined : sql`false`,
                allowedPipelines === null ? undefined : allowedPipelines.length
                  ? inArray(crmDeals.pipelineId, allowedPipelines) : sql`false`,
                session.operator.role === "admin" || session.permissions?.crm?.canViewAllDeals === true
                  ? undefined : eq(crmDeals.operatorId, session.operator.id),
              ),
            )
            .orderBy(desc(crmDeals.updatedAt))
            .limit(3),

          db
            .select({
              extractedData: agentFlowStates.collectedData,
              currentStage: agentFlowStates.currentStep,
            })
            .from(agentFlowStates)
            .where(
              and(
                eq(agentFlowStates.tenantId, tenantId),
                eq(agentFlowStates.conversationId, conversationId),
              ),
            )
            .orderBy(desc(agentFlowStates.lastInteractionAt))
            .limit(1),
        ]);

        if (accountRows.length > 0) {
          const acc = accountRows[0];
          const addr = (acc.address || {}) as Record<string, any>;
          const cityUf = [addr.city || addr.cidade, addr.state || addr.uf]
            .filter(Boolean)
            .join("/");
          const accParts = [
            `Empresa/Conta: ${acc.tradeName || acc.name}`,
            acc.document ? `${(acc.documentType || "DOC").toUpperCase()}: ${acc.document}` : "",
            acc.segment ? `Segmento: ${acc.segment}` : "",
            cityUf ? `Local: ${cityUf}` : "",
          ].filter(Boolean);
          crmLines.push(`🏢 CONTA VINCULADA: ${accParts.join(" | ")}`);
        }

        if (linkedDeals.length > 0) {
          const primaryDeal = linkedDeals[0];
          const [dealProducts, dealActivities, rawCfDefs] = await Promise.all([
            db
              .select({
                name: crmDealProducts.name,
                quantity: crmDealProducts.quantity,
                unitPrice: crmDealProducts.unitPrice,
                totalPrice: crmDealProducts.totalPrice,
              })
              .from(crmDealProducts)
              .where(
                and(
                  eq(crmDealProducts.tenantId, tenantId),
                  eq(crmDealProducts.dealId, primaryDeal.dealId),
                ),
              )
              .limit(6)
              .catch(() => []),
            db
              .select({
                type: crmDealActivities.type,
                title: crmDealActivities.title,
                status: crmDealActivities.status,
                dueDate: crmDealActivities.dueDate,
              })
              .from(crmDealActivities)
              .where(
                and(
                  eq(crmDealActivities.tenantId, tenantId),
                  eq(crmDealActivities.dealId, primaryDeal.dealId),
                ),
              )
              .orderBy(desc(crmDealActivities.createdAt))
              .limit(4)
              .catch(() => []),
            db
              .select()
              .from(crmCustomFieldDefinitions)
              .where(
                and(
                  eq(crmCustomFieldDefinitions.tenantId, tenantId),
                  eq(crmCustomFieldDefinitions.entityType, "deal"),
                  isNull(crmCustomFieldDefinitions.archivedAt),
                ),
              )
              .orderBy(asc(crmCustomFieldDefinitions.sortOrder))
              .catch(() => []),
          ]);

          const cfDefMap = new Map(
            rawCfDefs.map((row) => [
              row.id,
              {
                ...row,
                options: parseJsonArray<{ id: string; label: string }>(row.options),
                pipelineIds: parseJsonArray<string>(row.pipelineIds),
              },
            ]),
          );

          for (const d of linkedDeals) {
            const valFormatted =
              d.value && Number(d.value) > 0
                ? `R$ ${Number(d.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                : "Valor em definição";
            const cfObj =
              d.customFields && typeof d.customFields === "object" && !Array.isArray(d.customFields)
                ? (d.customFields as Record<string, unknown>)
                : {};
            const decodedCfItems: string[] = [];
            for (const [k, v] of Object.entries(cfObj)) {
              if (!isFilled(v)) continue;
              const def = cfDefMap.get(k);
              if (def) {
                const label = formatCustomFieldLabel(def, v);
                if (label) decodedCfItems.push(`${def.name}: ${label}`);
              } else {
                decodedCfItems.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
              }
            }
            const cfSuffix =
              decodedCfItems.length > 0 ? ` | Campos Personalizados: ${decodedCfItems.join(" | ")}` : "";
            const closeSuffix = d.expectedCloseDate ? ` | Prev. Fechamento: ${d.expectedCloseDate}` : "";
            const ratingSuffix = d.rating && d.rating > 0 ? ` | Qualificação: ${d.rating}/5` : "";
            crmLines.push(
              `💼 NEGOCIAÇÃO CRM: "${d.title}" | Funil: ${d.pipelineName || "Geral"} → Etapa: ${d.stageName || "Inicial"} | Status: ${d.status} | Valor: ${valFormatted}${closeSuffix}${ratingSuffix}${cfSuffix}`,
            );
          }

          if (dealProducts.length > 0) {
            const prodList = dealProducts
              .map((p) => `${p.name} (Qtd: ${Number(p.quantity || 1)}, Total: R$ ${Number(p.totalPrice || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`)
              .join("; ");
            crmLines.push(`📦 PRODUTOS NA NEGOCIAÇÃO: ${prodList}`);
          }

          const pendingTasks = dealActivities.filter((a) => a.status === "pending");
          if (pendingTasks.length > 0) {
            crmLines.push(
              `📅 PRÓXIMA TAREFA CRM: ${pendingTasks.map((t) => t.title).join(" | ")}`,
            );
          }
        }

        if (sdrStates.length > 0 && sdrStates[0].extractedData) {
          const ext = sdrStates[0].extractedData as Record<string, any>;
          const sdrEntries = Object.entries(ext)
            .filter(([_, v]) => v !== null && v !== undefined && String(v).trim() !== "")
            .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
          if (sdrEntries.length > 0) {
            crmLines.push(`🤖 DADOS DA TRIAGEM SDR: ${sdrEntries.join(" | ")}`);
          }
        }

        if (dbMsgs.length > 0) {
          normalizedMsgs = dbMsgs.reverse().map((m) => {
            const isInternal = Boolean(m.isInternalNote);
            const isSystem =
              m.senderType === "system" || m.senderName === "Sistema";
            const isClient =
              !isInternal &&
              !isSystem &&
              (m.senderType === "client" || m.senderType === "contact");

            const formattedText = formatMessageContentForAi(
              m.content,
              m.mediaInterpretation,
            );
            const timeStr = m.sentAt
              ? new Date(m.sentAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : undefined;

            return {
              role: isSystem
                ? "system"
                : isInternal
                  ? "internal"
                  : isClient
                    ? "client"
                    : "consultant",
              author: isClient
                ? convRow.contactName || contactName || "Cliente"
                : m.senderName || "Consultor",
              text: formattedText,
              time: timeStr,
            };
          });
        }
      }
    } catch (err: any) {
      console.warn("[assistant-engine] Aviso ao consultar contexto do banco:", err?.message);
    }
  }

  // 2. Fallback / complemento com as mensagens enviadas pelo frontend (caso o banco ainda não tenha ou seja conversa em memória)
  if (normalizedMsgs.length === 0 && Array.isArray(clientMessages) && clientMessages.length > 0) {
    normalizedMsgs = clientMessages.slice(-maxMessages).map((m: any) => {
      const isInternal = Boolean(m.isInternalNote || m.isInternal);
      const isSystem =
        m.sender === "system" || m.senderType === "system" || m.author === "Sistema";
      const isClient =
        !isInternal &&
        !isSystem &&
        (m.side === "in" || m.sender === "client" || m.senderType === "client" || m.senderType === "contact");

      return {
        role: isSystem
          ? "system"
          : isInternal
            ? "internal"
            : isClient
              ? "client"
              : "consultant",
        author: isClient ? contactName || "Cliente" : m.author || "Consultor",
        text: formatMessageContentForAi(m.text || m.content || "", m.mediaInterpretation),
        time: m.time,
      };
    });
  }

  // Filtra mensagens vazias e mensagens de sistema automáticas irrelevantes
  const visibleMsgs = normalizedMsgs.filter(
    (m) => m.role === "client" || m.role === "consultant",
  );
  const internalNotes = normalizedMsgs.filter(
    (m) =>
      m.role === "internal" &&
      !m.text.startsWith("📋 RESUMO DO") &&
      !m.text.startsWith("[RESUMO DO"),
  );

  const visibleTranscript = visibleMsgs
    .map((m) => {
      const label = m.role === "client" ? "Cliente" : `Consultor (${m.author})`;
      const timePrefix = m.time ? `[${m.time}] ` : "";
      return `${timePrefix}${label}: ${m.text}`;
    })
    .join("\n");

  const internalNotesTranscript = internalNotes
    .slice(-5)
    .map((m) => `[Nota Interna - ${m.author}]: ${m.text}`)
    .join("\n");

  // Extrai o último bloco de mensagens consecutivas do cliente (ou as últimas 3 falas do cliente)
  const trailingClientMsgs: string[] = [];
  for (let i = visibleMsgs.length - 1; i >= 0; i--) {
    if (visibleMsgs[i].role === "client") {
      trailingClientMsgs.unshift(visibleMsgs[i].text);
    } else if (trailingClientMsgs.length > 0) {
      break;
    }
  }

  const lastSpeaker: "client" | "consultant" | "none" =
    visibleMsgs.length === 0
      ? "none"
      : visibleMsgs[visibleMsgs.length - 1].role === "client"
        ? "client"
        : "consultant";

  const recentClientTexts = visibleMsgs
    .filter((m) => m.role === "client")
    .slice(-4)
    .map((m) => m.text)
    .join(" ");

  return {
    visibleTranscript,
    internalNotesTranscript,
    lastClientMessagesText:
      trailingClientMsgs.length > 0
        ? trailingClientMsgs.join("\n")
        : visibleMsgs
            .filter((m) => m.role === "client")
            .slice(-2)
            .map((m) => m.text)
            .join("\n"),
    lastSpeaker,
    crmAndContactContext: crmLines.join("\n"),
    knowledgeQueryHint: recentClientTexts.slice(0, 220),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PROMPTS ESPECIALISTAS PARA MELHOR RESPOSTA E RESUMO DO ATENDIMENTO
// ═══════════════════════════════════════════════════════════════════════════════

const TECFAG_INDUSTRIAL_EXPERTISE = `DIRETRIZES TÉCNICAS E COMERCIAIS — GRUPO TECFAG (MÁQUINAS INDUSTRIAIS DE EMBALAGEM):
- Linhas de Equipamentos do Grupo Tecfag:
  1. Seladoras: Manuais (ex: PCS200, PCS300, PCS400), Seladoras de Pedal, Seladoras Contínuas Automáticas (horizontais e verticais, com ou sem datador), Seladoras a Vácuo (câmara simples/dupla, ex: DZ260, DZ400, DZ500) e Seladoras por Indução Eletromagnética (para lacres de alumínio em potes/frascos).
  2. Envasadoras e Dosadoras: Líquidos, pastosos/viscosos (géis, cremes, molhos), pós e grãos (semi-automáticas e automáticas).
  3. Datadores e Codificadores: Datadores Inkjet (jato de tinta contínuo / TIJ), Hot Stamping, Thermal Transfer (TTO) e bancada.
  4. Empacotadoras, Encapsuladoras, Contadoras de Cápsulas/Comprimidos, Rotuladoras e Fechadoras de Caixas/Fardos.
  5. Linha Personnalité: Projetos industriais customizados e linhas de alta produtividade.
  6. Pós-Venda: Peças de Reposição (resistências, teflon, correias, placas, sensores) e Assistência Técnica Especializada.
- Postura do Consultor Tecfag no WhatsApp:
  • Direto, técnico, consultivo e focado em destravar a venda ou o diagnóstico técnico.
  • Para recomendar ou orçar máquina, as variáveis técnicas essenciais são: (1) Qual produto vai embalar/envasar/datar; (2) Tipo e medida da embalagem ou peso/volume da dose; (3) Produção estimada (unidades/hora ou dia); (4) CNPJ/CPF e CEP para proposta formal e cotação de frete.
  • Para Peças ou Assistência Técnica: confirmar o modelo exato da máquina (ou pedir foto da etiqueta/plaqueta e vídeo curto do equipamento).`;

import { lookupVtexProductsForAssistant } from "./vtex-assistant-service";

const VALEM_COMMERCIAL_EXPERTISE = `DIRETRIZES COMERCIAIS — VALEM VÁLVULAS E EMBALAGENS:
- Produtos: Válvulas Spray (perfumes/líquidos), Válvulas Pump/Saboneteira (cremes/géis), Mini Triggers (borrifadores), Tampas Luxo, Frascos e Potes de Vidro Âmbar (10ml a 100ml) e PEAD/PET. Roscas: 18/410, 20/410, 24/410, 28/410.
- Atacado B2B no WhatsApp (CNPJ): mínimo de 1.000 unidades por item, faturamento PJ e condições especiais.
- Varejo/Fracionado no Site (www.valempack.com.br): a partir de 50 unidades com 15% de desconto para CNPJ.`;

export async function buildBestResponsePrompt(params: {
  tenantId: string;
  operatorName: string;
  contactName: string;
  currentDraftText: string;
  richContext: ConversationRichContext;
}): Promise<string> {
  const { tenantId, operatorName, contactName, currentDraftText, richContext } = params;
  const persona = getAiPersona(tenantId);
  const isTecfag = tenantId === "tecfag";

  // Carrega base de conhecimento e consulta VTEX em paralelo com queryHint das últimas falas do cliente
  let knowledgeSnippet = "";
  let vtexSnippet = "";
  try {
    const queryHint = `${currentDraftText || ""} ${richContext.knowledgeQueryHint || ""}`.trim();
    const [rawKb, vtexResult] = await Promise.all([
      getKnowledgeBaseContext(tenantId, queryHint).catch(() => ""),
      isTecfag
        ? lookupVtexProductsForAssistant({
            tenantId,
            userQuery: queryHint,
            recentHistoryText: richContext.visibleTranscript.slice(-1200),
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    knowledgeSnippet = rawKb ? rawKb.slice(0, 12000) : "";
    if (vtexResult && vtexResult.invoked && vtexResult.promptContext) {
      vtexSnippet = vtexResult.promptContext.slice(0, 6000);
    }
  } catch {
    knowledgeSnippet = "";
  }

  const domainRules = isTecfag ? TECFAG_INDUSTRIAL_EXPERTISE : VALEM_COMMERCIAL_EXPERTISE;
  const cleanDraft = (currentDraftText || "").trim();

  const draftInstruction = cleanDraft
    ? `🎯 RASCUNHO / INTENÇÃO ATUAL DO CONSULTOR (${operatorName}):
"${cleanDraft}"
-> O consultor começou a escrever ou anotou a ideia acima. Transforme essa intenção em uma mensagem final impecável, natural, técnica e pronta para enviar ao cliente no WhatsApp.`
    : richContext.lastSpeaker === "client" && richContext.lastClientMessagesText
      ? `🎯 ÚLTIMA MENSAGEM DO CLIENTE QUE PRECISA SER RESPONDIDA AGORA:
"${richContext.lastClientMessagesText}"
-> Responda diretamente ao que o cliente acabou de perguntar ou informar acima e conduza para o próximo passo prático.`
      : `🎯 SITUAÇÃO DA CONVERSA:
A última mensagem foi enviada pelo consultor (ou a conversa está aguardando retomada). Escreva uma mensagem curta e natural de acompanhamento (follow-up consultivo) baseada no assunto específico que estava sendo tratado.`;

  return `Você é ${persona.name}, especialista sênior em atendimento da ${persona.company}.
Formule a MELHOR mensagem de WhatsApp para o consultor "${operatorName}" enviar AGORA ao cliente "${contactName || "Cliente"}".

${domainRules}

${richContext.crmAndContactContext ? `📊 CONTEXTO DO CLIENTE E NEGOCIAÇÃO NO CRM:\n${richContext.crmAndContactContext}\n` : ""}
${richContext.internalNotesTranscript ? `📝 NOTAS INTERNAS DA EQUIPE:\n${richContext.internalNotesTranscript}\n` : ""}
💬 HISTÓRICO RECENTE DA CONVERSA NO WHATSAPP:
${richContext.visibleTranscript || "Início de atendimento (sem mensagens anteriores)."}

${draftInstruction}
${knowledgeSnippet ? `\n${knowledgeSnippet}\n` : ""}${vtexSnippet ? `\n${vtexSnippet}\n` : ""}
REGRAS OBRIGATÓRIAS DE QUALIDADE (PROIBIDO RESPOSTA GENÉRICA):
1. SEJA ESPECÍFICO: Cite diretamente a máquina, peça, produto, medida, documento ou dúvida real mencionada na conversa/CRM. É TERMINANTEMENTE PROIBIDO gerar frases genéricas vazias como "Como posso ajudar com suas necessidades hoje?" ou "Estamos à disposição para oferecer a melhor solução".
2. FORMATO WHATSAPP HUMANO: Escreva de 1 a 3 frases curtas, diretas e naturais, como um consultor humano experiente escreve no WhatsApp.
3. SEM SAUDAÇÃO REPETIDA: Se a conversa já está em andamento no histórico hoje, NÃO comece repetindo "Olá, tudo bem? Aqui é o ${operatorName}...". Vá direto à resposta!
4. FECHAMENTO COM AÇÃO: Termine com UMA pergunta objetiva que faça o atendimento avançar (ex: confirmar produto/medida/produção, enviar vídeo de teste, validar voltagem ou solicitar CNPJ/CEP para orçamento).
5. NÃO inclua tags internas como [SEND_IMAGE:...]. Retorne APENAS o texto final da mensagem pronta para envio, sem aspas.`;
}

export function buildLeadSummaryPrompt(params: {
  tenantId: string;
  contactName: string;
  richContext: ConversationRichContext;
}): string {
  const { tenantId, contactName, richContext } = params;
  const persona = getAiPersona(tenantId);
  const isTecfag = tenantId === "tecfag";

  const formatTemplate = isTecfag
    ? `📋 RESUMO DO ATENDIMENTO — GRUPO TECFAG
• Cliente / Empresa: (Nome do contato, Empresa, CNPJ/CPF e Cidade/UF — ou "Ainda não informado")
• Equipamento / Peça de Interesse: (Máquina, modelo, linha ou peça/suporte solicitado especificamente na conversa)
• Aplicação & Produção: (Qual produto o cliente vai embalar/envasar/datar, tipo/medida de embalagem e volume de produção)
• O que já foi tratado: (Resumo objetivo do que já foi conversado: vídeos/fotos enviadas, valores, frete, dúvidas técnicas ou objeções)
• Situação Atual: (Em que ponto exato o atendimento está agora)
• Próximo Passo Recomendado: (Ação prática e direta para o consultor executar)`
    : `📋 RESUMO DO LEAD — VALEM
• Cliente / Perfil: (Nome, Empresa, CNPJ/Atacado ou CPF/Varejo e Cidade/UF — ou "Ainda não informado")
• Produtos & Especificações: (Válvulas, frascos, potes, roscas, cores e quantidades solicitadas)
• O que já foi tratado: (Valores cotados, orientação site/atacado, amostras, frete ou objeções)
• Situação Atual: (Em que ponto exato o atendimento está agora)
• Próximo Passo Recomendado: (Ação comercial prática para a vendedora executar)`;

  return `Você é ${persona.name}, especialista em inteligência comercial e técnica da ${persona.company}.
Analise todo o histórico real do atendimento e os dados do CRM abaixo para gerar um RESUMO ESTRUTURADO fiel e útil para Nota Interna.

${richContext.crmAndContactContext ? `📊 DADOS CADASTRADOS NO CRM / CONTATO:\n${richContext.crmAndContactContext}\n` : `👤 CONTATO: ${contactName || "Cliente"}\n`}
${richContext.internalNotesTranscript ? `📝 NOTAS INTERNAS ANTERIORES:\n${richContext.internalNotesTranscript}\n` : ""}
💬 HISTÓRICO COMPLETO DA CONVERSA:
${richContext.visibleTranscript || "Sem mensagens trocadas até o momento."}

REGRAS OBRIGATÓRIAS:
1. FIDELIDADE ABSOLUTA AOS FATOS: Extraia apenas informações reais presentes no histórico e nos dados do CRM acima. NUNCA invente máquinas, produtos, CNPJs ou valores. Se um dado ainda não foi mencionado na conversa, escreva claramente "Ainda não informado na conversa" (isso ajuda o consultor a saber o que falta perguntar).
2. SEJA ESPECÍFICO E ESCANEÁVEL: Cite nomes de máquinas, modelos, medidas, valores ou dúvidas reais que apareceram na conversa.
3. Siga EXATAMENTE a estrutura abaixo, sem introduções e sem comentários finais:

${formatTemplate}`;
}
