/**
 * Migração sob demanda no MEIO da triagem: Site (`conv-lc-*`) → WhatsApp Oficial.
 *
 * Acionada quando o cliente no Site pede para falar pelo WhatsApp / zap / telefone / ligação,
 * o Fagner oferece mandar mensagem no WhatsApp (citando o telefone ou pedindo DDD + número),
 * e o cliente confirma ("sim", "pode mandar", etc.).
 *
 * Regras aprovadas (perfil industrial — `valem` nunca passa por aqui):
 * 1. Isolamento estrito por `tenantId` em todas as queries e locks.
 * 2. Proteção de operador humano: se já existir consultor humano ativo no WhatsApp (`meus`),
 *    preserva o consultor sem sequestrar para `automacao`, espelha o histórico e registra nota interna.
 * 3. Envio híbrido no WhatsApp (quando `!hasActiveHuman`):
 *    - Janela Meta 24h ABERTA (ou provedor Baileys): envia texto livre composto pelo Gemini já
 *      retomando o próximo campo faltante da triagem (sem repetir dados já coletados).
 *    - Janela Meta 24h FECHADA: dispara Template Meta aprovado dedicado (`siteWhatsappMidTriageTemplateId`
 *      → fallback `fagner_site_continuacao_triagem_v1` → fallback `siteWhatsappTemplateId`).
 *      Assim que o cliente responder no WhatsApp, a janela abre e o Fagner continua de onde parou.
 * 4. Pós-envio confirmado:
 *    - Espelha 100% do histórico do Site (`lcx-*`) + despedida no Site + nota interna no WhatsApp.
 *    - Cria/reutiliza o card no `FUNIL CWR → CONTATANDO` (origem `livechat` / `Chat Site`), evitando
 *      perda do lead mesmo se o cliente demorar a responder o template.
 *    - Transfere o fluxo de triagem INCOMPLETA (`outcome: "in_progress"`, `handoffStatus: "collecting"`,
 *      `greetingDone: true`, `migratedFromSiteMidTriage: true`) para a conversa do WhatsApp com
 *      100% dos `collectedData` + `subflow` + `siteContext` + `vtexLookup`.
 *    - Encerra o chat do Site (`queueState: "finalizados"`, `lc_chats.status = "bridge_sent"`,
 *      `handoffStatus: "continued_to_whatsapp"`).
 */
import crypto from "node:crypto";
import { and, desc, eq, isNull, notLike, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  agentConfigs,
  agentFlowStates,
  contacts,
  conversations,
  lcChats,
  messages,
  metaMessageTemplates,
  operators,
  sectors,
} from "../../db/schema";
import { getAiPersona, type AiPersona } from "../ai-persona";
import { setAttendanceActor } from "../attendance-events";
import { SessionManager } from "../baileys/session-manager";
import {
  findConversationForContactPhone,
  resolveOrEnsureContactPhoneRow,
} from "../crm/contact-phones";
import {
  buildTemplatePayloadFromRecord,
  resolveApprovedRdTemplate,
} from "../rd-marketing/sdr-template-dispatch";
import { ensureCwrDealOnContacting } from "../triage/industrial-cwr-crm";
import { getDefaultSiteCampaignLabel } from "../marketing/crm-attribution";
import {
  INDUSTRIAL_POLICY_VERSION,
  normalizeTriageText,
  type CollectedFields,
  type IndustrialRoute,
  type RequiredField,
} from "../triage/industrial-policy";
import type { IndustrialDatabase, RodizioConfig } from "../triage/industrial-rodizio-store";
import { appendIndustrialJournal } from "../triage/industrial-triage-journal-store";
import { prioritizeMissingFieldsForConversation } from "../triage/industrial-reply-rewriter";
import { normalizeCanonicalPhone } from "../utils";
import { resolveConfiguredWhatsappProvider } from "../valentina/sdr-channel-sender";
import { vertexAi } from "../vertex-ai";
import { getMetaServiceWindow } from "../whatsapp/meta-policy";
import { outboundQueue } from "../whatsapp/outbound";
import {
  SITE_CHANNEL,
  formatBrPhoneForDisplay,
  isSiteConversationId,
  normalizeSitePhone,
  parseSiteChannelSettings,
  visitorIdFromSiteConversation,
} from "./site-channel-policy";
import { siteContextFromMessages } from "./site-context";
import { readSiteContinuationHistory } from "./site-conversation-store";
import {
  computeSiteHandoffMirrorTimestamps,
  resolveTemplateTopicSummary,
  shouldPreserveExistingWhatsappHumanOwner,
} from "./site-whatsapp-handoff";

const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export const DEFAULT_MID_TRIAGE_TEMPLATE_NAME = "fagner_site_continuacao_triagem_v1";

const MISSING_FIELD_DESCRIPTIONS: Record<RequiredField, string> = {
  name: "nome completo da pessoa",
  document: "CNPJ ou CPF da empresa",
  request: "qual equipamento, peça ou demanda precisa",
  application: "qual produto/aplicação vai embalar ou processar",
  production: "produtividade ou volume aproximado (unidades/pacotes/kg por hora ou dia)",
};

/**
 * Detecta no Site pedidos do cliente para falar pelo WhatsApp, zap, telefone ou ligação.
 * Usado como salvaguarda para que o Fagner ofereça WhatsApp antes de escalar para ligação humana.
 */
export function isSiteChannelMigrationOrCallRequest(raw: string): boolean {
  const clean = String(raw || "").trim();
  if (!clean || clean.length > 350) return false;
  const text = normalizeTriageText(clean);
  if (!text) return false;

  // Pedidos explícitos de WhatsApp / Zap
  if (
    /\b(?:podemos|pode|da\s+pra|consegue|quero|prefiro|vamos|bora|melhor)\s+(?:falar|conversar|continuar|seguir|atender|ir|chamar|mandar|me\s+chamar)\s+(?:no|pelo|por|via|pro|para\s+o)?\s*(?:whats(?:app)?|zap|wpp)\b/.test(
      text,
    ) ||
    /\b(?:me\s+chama|chama\s+(?:eu|la)|manda\s+(?:uma\s+)?(?:msg|mensagem))\s+(?:no|pelo|via)?\s*(?:whats(?:app)?|zap|wpp)\b/.test(
      text,
    ) ||
    /\b(?:falar|conversar|continuar)\s+(?:no|pelo|por|via)\s+(?:whats(?:app)?|zap|wpp)\b/.test(
      text,
    ) ||
    /\b(?:tem|possui|atende(?:\s+no)?)\s+(?:whats(?:app)?|zap|wpp)\b/.test(text)
  ) {
    return true;
  }

  // Pedidos de telefone / celular / ligação (no Site, Fagner oferece WhatsApp primeiro!)
  if (
    /\b(?:poderia|pode|consegue|da\s+pra)\s+me\s+(?:chamar|ligar|contactar|contatar)\s*(?:(?:via|no|por|pelo)\s+(?:celular|telefone|fone|ligacao|whats(?:app)?|zap|wpp))?\b/.test(
      text,
    ) ||
    /\b(?:pode|poderia|consegue)\s+me\s+ligar\b/.test(text) ||
    /\b(?:me\s+liga|liga\s+(?:pra|para)\s+mim)\b/.test(text) ||
    /\b(?:podemos|quero|prefiro)\s+(?:falar|conversar)\s+(?:no|por|pelo|ao)\s+(?:telefone|celular|ligacao)\b/.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Detecta confirmação clara do cliente após o Fagner oferecer mandar mensagem no WhatsApp.
 */
export function isExplicitWhatsappMigrationConfirmation(raw: string): boolean {
  const clean = String(raw || "").trim();
  if (!clean || clean.length > 220) return false;
  const text = normalizeTriageText(clean);
  if (!text) return false;
  if (isExplicitPhoneCallInsistence(clean)) return false;
  if (
    /\b(?:nao|prefiro\s+(?:aqui|ficar|continuar\s+(?:aqui|no\s+site))|deixa|melhor\s+aqui)\b/.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /^(?:sim|s|claro|pode|pode\s+sim|pode\s+mandar|pode\s+chamar|por\s+favor|ok|okay|beleza|blz|fechado|combinado|bora|vamos|manda|manda\s+la|chama\s+la|quero\s+sim|com\s+certeza|isso|isso\s+mesmo|perfeito|otimo|show|tranquilo|tudo\s+bem)(?:[!.,\s]+(?:pode\s+(?:mandar|chamar|sim)|por\s+favor|no\s+whats(?:app)?|no\s+zap|la|sim|obrigad[oa]))*[!.\s]*$/.test(
      text,
    ) ||
    /\b(?:pode\s+(?:me\s+)?(?:mandar|chamar|enviar)|manda\s+(?:mensagem|msg|la)|chama\s+(?:la|no\s+(?:whats(?:app)?|zap))|quero\s+(?:sim|ir\s+pro\s+zap|continuar\s+(?:no|pelo)\s+(?:whats(?:app)?|zap)))\b/.test(
      text,
    )
  );
}

/**
 * Detecta quando o cliente recusa WhatsApp e insiste especificamente em ligação telefônica por voz.
 */
export function isExplicitPhoneCallInsistence(raw: string): boolean {
  const clean = String(raw || "").trim();
  if (!clean || clean.length > 300) return false;
  const text = normalizeTriageText(clean);
  if (!text) return false;
  return (
    /\b(?:nao\s+(?:uso|tenho|quero)\s+(?:whats(?:app)?|zap)|prefiro\s+(?:que\s+me\s+ligue|ligacao|por\s+ligacao|falar\s+por\s+ligacao|telefone\s+mesmo)|quero\s+(?:ligacao|que\s+me\s+ligue)|so\s+(?:por\s+)?ligacao|preciso\s+de\s+uma\s+ligacao|tem\s+que\s+ser\s+ligacao)\b/.test(
      text,
    ) ||
    (/\bnao\b/.test(text) && /\b(?:ligacao|me\s+liga|ligar|por\s+voz|telefone)\b/.test(text))
  );
}

/**
 * Extrai número de telefone BR válido informado livremente pelo visitante no chat do Site
 * (ex.: "(14) 99836-4338", "14 998364338", "+55 11 98765-4321"), evitando confundir com CNPJ (14 dígitos).
 */
export function extractSitePhoneCandidate(raw: string): string | null {
  const clean = String(raw || "").trim();
  if (!clean) return null;
  // Evitar capturar CNPJ formatado XX.XXX.XXX/XXXX-XX
  const withoutCnpj = clean.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, " ");
  const matches = withoutCnpj.match(
    /(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)(?:9?\d{4}[\s.-]*\d{4})\b/g,
  );
  if (!matches) return null;
  for (const m of matches) {
    const digits = m.replace(/\D/g, "");
    if (digits.length === 14) continue; // CNPJ sem máscara
    const normalized = normalizeSitePhone(m);
    if (normalized) return normalized;
  }
  return null;
}

const openingMessagesSchema = z.object({
  messagesToSend: z.unknown().transform((raw) => {
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    return list
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 1200))
      .filter((item) => item.length > 0)
      .slice(0, 2);
  }),
});

const singleTextSchema = z.object({
  message: z.unknown().transform((v) => (typeof v === "string" ? v.trim().slice(0, 1200) : "")),
});

export async function composeMidTriageWhatsappOpeningWithGemini(params: {
  tenantId: string;
  whatsappConversationId: string;
  aiPersona: AiPersona;
  clientName?: string | null;
  collectedData: CollectedFields;
  missingFields: readonly RequiredField[];
  siteHistoryExcerpt: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const orderedMissing = prioritizeMissingFieldsForConversation(params.missingFields);
  const nextMissingLabel = orderedMissing[0]
    ? MISSING_FIELD_DESCRIPTIONS[orderedMissing[0]] || orderedMissing[0]
    : "o detalhe pendente do seu atendimento";

  const cleanName = (params.clientName || "").trim();
  const firstName =
    cleanName && !/^(cliente|visitante|lead|sem nome|\+?\d)/i.test(cleanName)
      ? cleanName.split(/\s+/)[0]
      : "";
  const greetingPrefix = firstName ? `Oi, ${firstName}!` : "Oi!";
  const fallback = [
    `${greetingPrefix} Aqui é o ${params.aiPersona.name}, da ${params.aiPersona.company}. Conforme combinamos agora há pouco no site, estou te chamando aqui no WhatsApp para continuarmos de onde paramos.`,
    `Para darmos sequência, pode me informar ${nextMissingLabel}?`,
  ];

  if (!vertexAi.isReady()) return fallback;

  const collectedSummary: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.collectedData || {})) {
    if (k.startsWith("_")) continue;
    if (v?.status === "filled" && typeof v.value === "string" && v.value.trim()) {
      collectedSummary[k] = v.value.trim();
    }
  }

  const prompt = `Você é ${params.aiPersona.name}, assistente virtual de ${params.aiPersona.company}. Tom: ${params.aiPersona.tone}.
O cliente estava conversando com você no CHAT DO SITE e acabou de confirmar que quer continuar a triagem por aqui no WHATSAPP.

DADOS JÁ COLETADOS NO SITE (NUNCA pergunte novamente nenhum destes dados):
${JSON.stringify(collectedSummary)}

PRÓXIMO DADO FALTANTE PARA COLETAR AGORA:
${orderedMissing.map((f) => MISSING_FIELD_DESCRIPTIONS[f] || f).join("; ") || nextMissingLabel}

HISTÓRICO DO SITE:
${params.siteHistoryExcerpt.slice(-1800)}

Escreva 1 ou 2 balões curtos, simpáticos e naturais (estilo WhatsApp):
- Balão 1: cumprimente brevemente pelo nome (se souber) confirmando que é o ${params.aiPersona.name} continuando a conversa do site aqui no WhatsApp.
- Balão 2 (ou no mesmo balão): faça diretamente UMA pergunta clara e natural pedindo APENAS o próximo dado que faltava (${nextMissingLabel}), sem repetir nada que o cliente já respondeu no site.
- PROIBIDO dizer que já encaminhou para equipe/vendedor, PROIBIDO mencionar CRM/card e PROIBIDO fazer várias perguntas de uma vez.

Retorne EXCLUSIVAMENTE JSON válido:
{
  "messagesToSend": ["balão 1", "balão 2 opcional"]
}`;

  try {
    const raw = await vertexAi.generateStructuredJson<unknown>(
      prompt,
      "gemini-2.5-flash",
      params.signal,
      {
        tenantId: params.tenantId,
        feature: "sdr_agent",
        generationConfig: { thinkingBudget: 0 },
        metadata: {
          conversationId: params.whatsappConversationId,
          composeMode: "site_mid_triage_wa_opening",
        },
      },
    );
    const parsed = openingMessagesSchema.safeParse(raw);
    if (parsed.success && parsed.data.messagesToSend.length > 0) {
      return parsed.data.messagesToSend;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[SiteMidTriage] Falha ao compor abertura no WhatsApp via Gemini (${params.whatsappConversationId}):`,
      msg,
    );
  }
  return fallback;
}

export async function composeMidTriageSiteGoodbyeWithGemini(params: {
  tenantId: string;
  siteConversationId: string;
  aiPersona: AiPersona;
  clientName?: string | null;
  phoneDisplay?: string | null;
  hasActiveHuman: boolean;
  deliveryMode: "free_text" | "meta_template" | "human_preserved";
  signal?: AbortSignal;
}): Promise<string> {
  const cleanName = (params.clientName || "").trim();
  const firstName =
    cleanName && !/^(cliente|visitante|lead|sem nome|\+?\d)/i.test(cleanName)
      ? cleanName.split(/\s+/)[0]
      : "";
  const phoneLabel = params.phoneDisplay ? ` no número ${params.phoneDisplay}` : "";
  const fallback = params.hasActiveHuman
    ? `Perfeito${firstName ? `, ${firstName}` : ""}! Já levei todo o histórico aqui do site para o seu atendimento que já está aberto no WhatsApp${phoneLabel}. Pode continuar por lá!`
    : `Pronto${firstName ? `, ${firstName}` : ""}! Acabei de te mandar uma mensagem lá no WhatsApp${phoneLabel}. Pode responder por lá que continuamos exatamente de onde paramos!`;

  if (!vertexAi.isReady()) return fallback;

  const actionContext = params.hasActiveHuman
    ? `o cliente já tem atendimento humano aberto no WhatsApp${phoneLabel} e você acabou de levar todo o histórico do site para lá`
    : `você acabou de mandar mensagem no WhatsApp do cliente${phoneLabel} para continuar a triagem exatamente de onde pararam`;

  const prompt = `Você é ${params.aiPersona.name}, assistente virtual de ${params.aiPersona.company}. Tom: ${params.aiPersona.tone}.
Escreva UMA única mensagem curta, simpática e natural para encerrar este chat do site avisando que ${actionContext}.
- OBRIGATÓRIO mencionar "WhatsApp" e manter tom natural em 1ª pessoa.
- PROIBIDO fazer novas perguntas ("?") e PROIBIDO mencionar CRM/card/sistema.

Retorne EXCLUSIVAMENTE JSON válido:
{
  "message": "texto natural aqui"
}`;

  try {
    const raw = await vertexAi.generateStructuredJson<unknown>(
      prompt,
      "gemini-2.5-flash",
      params.signal,
      {
        tenantId: params.tenantId,
        feature: "sdr_agent",
        generationConfig: { thinkingBudget: 0 },
        metadata: {
          conversationId: params.siteConversationId,
          composeMode: "site_mid_triage_goodbye",
          deliveryMode: params.deliveryMode,
        },
      },
    );
    const parsed = singleTextSchema.safeParse(raw);
    if (
      parsed.success &&
      parsed.data.message &&
      !parsed.data.message.includes("?") &&
      /whatsapp/i.test(parsed.data.message)
    ) {
      return parsed.data.message;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[SiteMidTriage] Falha ao compor despedida do Site via Gemini (${params.siteConversationId}):`,
      msg,
    );
  }
  return fallback;
}

/**
 * Resolve o template oficial Meta APPROVED para migração no MEIO da triagem:
 * 1) `whatsappMidTriageTemplateId` configurado na aba Canal do Site;
 * 2) Template padrão `fagner_site_continuacao_triagem_v1` se aprovado no tenant;
 * 3) Fallback para `whatsappTemplateId` (template pós-triagem configurado).
 */
export async function resolveMidTriageMetaTemplate(
  database: IndustrialDatabase,
  tenantId: string,
  siteSettings: { whatsappMidTriageTemplateId?: string; whatsappTemplateId?: string },
) {
  const candidates = [
    siteSettings.whatsappMidTriageTemplateId?.trim() || "",
    DEFAULT_MID_TRIAGE_TEMPLATE_NAME,
    siteSettings.whatsappTemplateId?.trim() || "",
  ].filter(Boolean);

  const tried = new Set<string>();
  for (const ref of candidates) {
    if (tried.has(ref)) continue;
    tried.add(ref);
    try {
      const resolved = await resolveApprovedRdTemplate(tenantId, ref, { persistAutoHeal: false });
      if (resolved.template) return resolved.template;
    } catch {
      // fallback direto no banco se helper falhar em mock parcial
      try {
        const [row] = await database
          .select()
          .from(metaMessageTemplates)
          .where(
            and(
              eq(metaMessageTemplates.tenantId, tenantId),
              eq(metaMessageTemplates.status, "APPROVED"),
              or(
                eq(metaMessageTemplates.id, ref),
                eq(metaMessageTemplates.metaTemplateId, ref),
                eq(metaMessageTemplates.name, ref),
              ),
            ),
          )
          .limit(1);
        if (row) {
          return {
            id: row.id,
            metaTemplateId: row.metaTemplateId,
            name: row.name,
            language: row.language,
            bodyText: row.bodyText,
            bindings:
              (row.bindings as Record<
                string,
                "customer_name" | "operator_name" | "manual"
              > | null) || null,
          };
        }
      } catch {
        // Ignora erro em banco de teste sem tabela meta_message_templates
      }
    }
  }
  return null;
}

export interface SiteMidTriageWhatsappInput {
  tenantId: string;
  siteConversationId: string;
  siteFlowId: string;
  cycle: string;
  route: IndustrialRoute | null;
  data: CollectedFields;
  missingFields: readonly RequiredField[];
  clientName: string;
  companyName: string;
  contactId: string | null;
  providedPhone?: string | null;
  siteContext?: unknown;
  vtexLookup?: unknown;
  signal?: AbortSignal;
}

export interface SiteMidTriageWhatsappResult {
  migrated: boolean;
  reason?: string;
  deliveryMode?: "free_text" | "meta_template" | "human_preserved";
  whatsappConversationId?: string;
  dealId?: string | null;
  dealTitle?: string | null;
  templateName?: string | null;
  closingMessageForSite?: string;
  preservedHumanOperator?: boolean;
}

function summarizeMidTriageNote(params: {
  data: CollectedFields;
  missingFields: readonly RequiredField[];
  deliveryMode: "free_text" | "meta_template" | "human_preserved";
  templateName?: string | null;
  subflow?: string | null;
  targetFunnel?: string | null;
}): string {
  const modeLabel =
    params.deliveryMode === "human_preserved"
      ? "Atendimento humano já ativo no WhatsApp preservado (histórico do site anexado)"
      : params.deliveryMode === "free_text"
        ? "Texto livre enviado direto no WhatsApp (janela Meta 24h aberta) — triagem continua de onde parou"
        : `Template Meta enviado (${params.templateName || "site"}) — aguardando resposta do cliente no WhatsApp para continuar coleta`;

  const lines = [
    "Cliente solicitou continuar a triagem do Site no WhatsApp",
    `Modo de continuidade: ${modeLabel}`,
    ...(params.targetFunnel || params.subflow
      ? [`Fluxo parcial: ${params.targetFunnel || params.subflow}`]
      : []),
    ...(params.missingFields.length > 0
      ? [
          `Campos ainda pendentes: ${params.missingFields
            .map((f) => MISSING_FIELD_DESCRIPTIONS[f] || f)
            .join(", ")}`,
        ]
      : []),
  ];

  const entries = Object.entries(params.data || {}).filter(
    ([k, v]) => !k.startsWith("_") && typeof v?.value === "string" && v.value.trim().length > 0,
  );
  if (entries.length > 0) {
    lines.push("", "Dados já coletados no site:");
    for (const [k, v] of entries) {
      lines.push(`${k}: ${v.value!.trim()}`);
    }
  }
  return lines.join("\n");
}

export async function executeMidTriageSiteToWhatsApp(
  database: IndustrialDatabase,
  input: SiteMidTriageWhatsappInput,
): Promise<SiteMidTriageWhatsappResult> {
  const { tenantId, siteConversationId, siteFlowId, cycle } = input;
  if (!isSiteConversationId(siteConversationId)) {
    return { migrated: false, reason: "not_site_conversation" };
  }

  const persona = getAiPersona(tenantId);
  if (persona.triagePolicy !== "industrial") {
    return { migrated: false, reason: "non_industrial_tenant" };
  }

  // 1. Carregar configurações do canal Site
  const [sdrConfigRow] = await database
    .select({ enabled: agentConfigs.enabled, config: agentConfigs.config })
    .from(agentConfigs)
    .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "sdr")))
    .limit(1);

  const siteSettings = parseSiteChannelSettings(
    sdrConfigRow?.enabled === 1,
    sdrConfigRow?.config as Record<string, unknown>,
  );

  // 2. Carregar conversa do site + contato + telefone válido
  const [siteConv] = await database
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, siteConversationId)))
    .limit(1);

  if (!siteConv || siteConv.operatorId || siteConv.queueState === "finalizados") {
    return { migrated: false, reason: "site_conversation_unavailable" };
  }

  const resolvedContactId = input.contactId || siteConv.contactId;
  const [contact] = resolvedContactId
    ? await database
        .select()
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, resolvedContactId)))
        .limit(1)
    : [];

  if (!contact) {
    return { migrated: false, reason: "contact_not_found" };
  }

  const rawPhone =
    input.providedPhone ||
    contact.phone ||
    input.data["TELEFONE"]?.value ||
    siteConv.contactPhone ||
    "";
  const canonicalPhone = normalizeCanonicalPhone(rawPhone);
  if (!canonicalPhone) {
    return { migrated: false, reason: "missing_phone" };
  }

  // Se o cliente informou um número que ainda não estava salvo no contato, salva no contato
  if (!contact.phone?.trim() && canonicalPhone) {
    await database
      .update(contacts)
      .set({ phone: canonicalPhone })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contact.id)));
  }

  // 3. Localizar ou criar conversa oficial de WhatsApp (nunca conv-lc-* e nunca Baileys pessoal)
  const waPrep = await database.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${`site_wa_handoff:${contact.id}`}))`,
    );

    const matchedPhone = await resolveOrEnsureContactPhoneRow(tx, tenantId, contact.id, {
      phone: canonicalPhone,
    });

    let waConv = await findConversationForContactPhone(
      tx,
      tenantId,
      contact.id,
      matchedPhone,
      null,
    );
    if (waConv && isSiteConversationId(waConv.id)) {
      waConv = null;
    }
    if (!waConv) {
      const [fallbackConv] = await tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tenantId),
            eq(conversations.contactId, contact.id),
            isNull(conversations.whatsappConnectionId),
            notLike(conversations.id, "conv-lc-%"),
          ),
        )
        .orderBy(desc(conversations.lastMessageTime))
        .limit(1);
      waConv = fallbackConv || null;
    }

    const now = new Date();
    if (waConv) {
      let operatorHasSectorOrRodizio = false;
      if (waConv.queueState !== "finalizados" && waConv.operatorId !== null) {
        const [tenantSectors, rodizioRows] = await Promise.all([
          tx
            .select({ id: sectors.id, operatorIds: sectors.operatorIds })
            .from(sectors)
            .where(eq(sectors.tenantId, tenantId)),
          tx
            .select({ config: agentConfigs.config })
            .from(agentConfigs)
            .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.agentType, "rodizio")))
            .limit(1),
        ]);
        const inAnySector = tenantSectors.some(
          (s) => Array.isArray(s.operatorIds) && s.operatorIds.includes(waConv!.operatorId!),
        );
        const rodizioCfg = ((rodizioRows[0]?.config as RodizioConfig | undefined) ||
          {}) as RodizioConfig;
        const flowOps = Array.isArray(rodizioCfg.flowOperators) ? rodizioCfg.flowOperators : [];
        const inRodizio = flowOps.some(
          (op) => op && op.id === waConv!.operatorId && op.isParticipating !== false,
        );
        const tenantHasRoutingStructure = tenantSectors.length > 0 || flowOps.length > 0;
        operatorHasSectorOrRodizio = !tenantHasRoutingStructure || inAnySector || inRodizio;
      }

      if (waConv.queueState !== "finalizados") {
        let hasNonInternalMessages = false;
        if (waConv.queueState === "meus" && waConv.operatorId === null) {
          const [realMsg] = await tx
            .select({ id: messages.id })
            .from(messages)
            .where(
              and(
                eq(messages.tenantId, tenantId),
                eq(messages.conversationId, waConv.id),
                eq(messages.isInternalNote, false),
              ),
            )
            .limit(1);
          hasNonInternalMessages = Boolean(realMsg);
        }

        if (
          shouldPreserveExistingWhatsappHumanOwner({
            queueState: waConv.queueState,
            operatorId: waConv.operatorId,
            hasNonInternalMessages,
            operatorHasSectorOrRodizio,
          })
        ) {
          return {
            conversation: waConv,
            hasActiveHuman: true,
          };
        }
      }

      await setAttendanceActor(tx, tenantId, `${persona.name} (Site → WhatsApp)`, null);
      const [updated] = await tx
        .update(conversations)
        .set({
          queueState: "automacao",
          operatorId: null,
          sectorId: null,
          updatedAt: now,
        })
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, waConv.id)))
        .returning();
      return {
        conversation: updated || waConv,
        hasActiveHuman: false,
      };
    }

    const newWaConvId = `conv-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    await setAttendanceActor(tx, tenantId, `${persona.name} (Site → WhatsApp)`, null);
    const [created] = await tx
      .insert(conversations)
      .values({
        id: newWaConvId,
        tenantId,
        contactId: contact.id,
        contactPhoneId: matchedPhone?.id || null,
        contactPhone: matchedPhone?.phone || canonicalPhone,
        whatsappConnectionId: null,
        operatorId: null,
        queueState: "automacao",
        unreadCount: 0,
        lastMessageText: "",
        version: 1,
        lastMessageTime: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return { conversation: created, hasActiveHuman: false };
  });

  const waConversationId = waPrep.conversation.id;
  const siteMsgsSnapshot = await readSiteContinuationHistory(
    database,
    tenantId,
    siteConversationId,
  );
  const siteHistoryExcerpt = siteMsgsSnapshot
    .slice(-14)
    .map(
      (m) =>
        `${m.senderType === "client" ? "Cliente" : persona.name}: ${String(m.content || "").slice(0, 260)}`,
    )
    .join("\n");

  // 4. Determinar modo de envio no WhatsApp (Híbrido: texto livre se janela 24h aberta, template se fechada)
  let deliveryMode: "free_text" | "meta_template" | "human_preserved" = waPrep.hasActiveHuman
    ? "human_preserved"
    : "meta_template";
  let sentAtMs: number | null = null;
  let usedTemplateName: string | null = null;

  if (!waPrep.hasActiveHuman) {
    const provider = await resolveConfiguredWhatsappProvider(tenantId);
    const metaWindow =
      provider === "meta"
        ? await getMetaServiceWindow(tenantId, waConversationId)
        : { open: true, expiresAt: null };

    if (metaWindow.open) {
      deliveryMode = "free_text";
      const waOpeningMessages = await composeMidTriageWhatsappOpeningWithGemini({
        tenantId,
        whatsappConversationId: waConversationId,
        aiPersona: persona,
        clientName: input.clientName || contact.name,
        collectedData: input.data,
        missingFields: input.missingFields,
        siteHistoryExcerpt,
        signal: input.signal,
      });

      for (let i = 0; i < waOpeningMessages.length; i++) {
        const bubble = waOpeningMessages[i];
        const sendResult = await outboundQueue.enqueueAndSend({
          tenantId,
          conversationId: waConversationId,
          recipientPhone: canonicalPhone,
          recipientUserId: contact.whatsappUserId || undefined,
          text: bubble,
          senderType: "bot",
          senderName: `${persona.name} (SDR)`,
          idempotencyKey: `site-mid-wa-free:${tenantId}:${siteConversationId}:${cycle}:${i}`,
        });
        if (!sendResult.success) {
          if (i === 0) {
            return {
              migrated: false,
              reason: sendResult.error || "whatsapp_free_text_send_failed",
              whatsappConversationId: waConversationId,
            };
          }
          break;
        }
        if (i === 0) {
          const parsed = sendResult.sentAtISO ? Date.parse(sendResult.sentAtISO) : NaN;
          sentAtMs = Number.isFinite(parsed) ? parsed : Date.now();
        }
      }
    } else {
      deliveryMode = "meta_template";
      const templateRow = await resolveMidTriageMetaTemplate(database, tenantId, siteSettings);
      if (!templateRow) {
        return {
          migrated: false,
          reason: "site_whatsapp_mid_triage_template_not_approved",
          whatsappConversationId: waConversationId,
        };
      }
      usedTemplateName = templateRow.name;

      // Monta payload do template respeitando {{1}} (nome) e eventual {{2}} (assunto se fallback p/ v1)
      const basePayload = buildTemplatePayloadFromRecord({
        template: {
          name: templateRow.name,
          language: templateRow.language,
          bodyText: templateRow.bodyText,
          bindings: templateRow.bindings,
        },
        clientName: input.clientName || contact.name,
        personaName: persona.name,
      });

      let renderedText = basePayload.renderedText;
      let templateComponents = basePayload.templateComponents;
      const bodyText = templateRow.bodyText || "";
      const varMatches = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g));
      const maxIdx = varMatches.length ? Math.max(...varMatches.map((m) => Number(m[1]) || 0)) : 0;
      if (maxIdx >= 2 && templateComponents?.[0]?.parameters) {
        const topic = resolveTemplateTopicSummary({
          data: input.data,
          route: input.route || {
            subflow: null,
            funnelStage: "triagem",
            targetFunnel: null,
            needsReview: false,
            reason: "collecting",
          },
        });
        const paramsArr = [...templateComponents[0].parameters];
        const bindings = (templateRow.bindings || {}) as Record<string, string>;
        let rebuilt = bodyText;
        for (let idx = 1; idx <= maxIdx; idx++) {
          const k = String(idx);
          let val = paramsArr[idx - 1]?.text || "";
          if (idx >= 2 && bindings[k] !== "operator_name" && bindings[k] !== "customer_name") {
            val = topic;
            paramsArr[idx - 1] = { type: "text", text: val };
          }
          rebuilt = rebuilt.replaceAll(`{{${k}}}`, val);
        }
        renderedText = rebuilt;
        templateComponents = [{ type: "body", parameters: paramsArr }];
      }

      const sendResult = await outboundQueue.enqueueAndSend({
        tenantId,
        conversationId: waConversationId,
        recipientPhone: canonicalPhone,
        recipientUserId: contact.whatsappUserId || undefined,
        text: renderedText,
        templateName: templateRow.name,
        templateLanguage: templateRow.language || "pt_BR",
        templateComponents,
        senderType: "bot",
        senderName: `${persona.name} (Site → WhatsApp)`,
        idempotencyKey: `site-mid-wa-tpl:${tenantId}:${siteConversationId}:${cycle}`,
      });

      if (!sendResult.success) {
        return {
          migrated: false,
          reason: sendResult.error || "meta_template_send_failed",
          whatsappConversationId: waConversationId,
          templateName: templateRow.name,
        };
      }
      const parsed = sendResult.sentAtISO ? Date.parse(sendResult.sentAtISO) : NaN;
      sentAtMs = Number.isFinite(parsed) ? parsed : Date.now();
    }
  }

  // 5. Compor despedida natural para o Site
  const closingMessageForSite = await composeMidTriageSiteGoodbyeWithGemini({
    tenantId,
    siteConversationId,
    aiPersona: persona,
    clientName: input.clientName || contact.name,
    phoneDisplay: formatBrPhoneForDisplay(canonicalPhone),
    hasActiveHuman: waPrep.hasActiveHuman,
    deliveryMode,
    signal: input.signal,
  });

  // 6. Pós-envio confirmado (transação atômica):
  //    espelhamento completo do site + despedida + nota interna + card CWR CONTATANDO +
  //    transferência da triagem incompleta p/ WhatsApp + encerramento do Site.
  const committed = await database.transaction(async (tx) => {
    const now = new Date();
    const siteMsgs = await readSiteContinuationHistory(tx, tenantId, siteConversationId);
    const lastSiteMsgMs =
      siteMsgs.length > 0 ? new Date(siteMsgs[siteMsgs.length - 1].sentAt).getTime() : null;
    const { closingSentAt, summaryNoteSentAt } = computeSiteHandoffMirrorTimestamps({
      lastSiteMsgMs,
      templateSentAtMs: sentAtMs,
      nowMs: now.getTime(),
    });

    const mirroredRows = siteMsgs.map((m) => ({
      id: `lcx-${sha256Hex(`${waConversationId}:${m.id}`).slice(0, 40)}`,
      tenantId,
      conversationId: waConversationId,
      senderType: m.senderType,
      senderName: m.senderName,
      content: m.content,
      isInternalNote: false,
      mediaInterpretation: m.mediaInterpretation,
      provider: SITE_CHANNEL,
      direction: m.direction,
      status: m.status === "pending" || m.status === "sending" ? "accepted" : m.status,
      metaDetails: {
        ...(siteContextFromMessages([m]) ? { siteContext: siteContextFromMessages([m]) } : {}),
        copiedFrom: { channel: SITE_CHANNEL, conversationId: siteConversationId, messageId: m.id },
      },
      sentAt: m.sentAt,
      updatedAt: now,
    }));

    const closingMirrorId = `lcx-close-${sha256Hex(`${waConversationId}:${siteConversationId}:mid:${cycle}`).slice(0, 34)}`;
    mirroredRows.push({
      id: closingMirrorId,
      tenantId,
      conversationId: waConversationId,
      senderType: "bot",
      senderName: `${persona.name} (SDR)`,
      content: closingMessageForSite,
      isInternalNote: false,
      mediaInterpretation: null,
      provider: SITE_CHANNEL,
      direction: "outbound",
      status: "accepted",
      metaDetails: {
        copiedFrom: {
          channel: SITE_CHANNEL,
          conversationId: siteConversationId,
          messageId: `site-mid-closing:${siteConversationId}:${cycle}`,
        },
        siteClosingMessage: true,
      },
      sentAt: closingSentAt,
      updatedAt: now,
    });

    const insertedMirrors = mirroredRows.length
      ? await tx.insert(messages).values(mirroredRows).onConflictDoNothing().returning()
      : [];

    const summaryNoteId = `note-swa-mid-${sha256Hex(`${tenantId}:${siteConversationId}:${cycle}`).slice(0, 30)}`;
    const [insertedNote] = await tx
      .insert(messages)
      .values({
        id: summaryNoteId,
        tenantId,
        conversationId: waConversationId,
        senderType: "system",
        senderName: `${persona.name} (Site → WhatsApp)`,
        content: summarizeMidTriageNote({
          data: input.data,
          missingFields: input.missingFields,
          deliveryMode,
          templateName: usedTemplateName,
          subflow: input.route?.subflow || null,
          targetFunnel: input.route?.targetFunnel || null,
        }),
        isInternalNote: true,
        provider: "internal",
        direction: "outbound",
        status: "delivered",
        sentAt: summaryNoteSentAt,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    // 6.2 Vincular jornada do site ao contato e fechar `lc_chats`
    const visitorId = visitorIdFromSiteConversation(siteConversationId);
    if (visitorId) {
      const existingCf = (contact.customFields as Record<string, unknown>) || {};
      const prevLinked = Array.isArray(existingCf.linkedSiteContactIds)
        ? existingCf.linkedSiteContactIds.filter((x): x is string => typeof x === "string")
        : [];
      const nextLinked = Array.from(new Set([...prevLinked, `cont-lc-${visitorId}`])).slice(-20);
      await tx
        .update(contacts)
        .set({
          ...(contact.mainChannel === SITE_CHANNEL ? { mainChannel: "whatsapp" } : {}),
          customFields: {
            ...existingCf,
            siteVisitorId: visitorId,
            linkedSiteContactIds: nextLinked,
          },
        })
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contact.id)));

      await tx
        .update(lcChats)
        .set({
          waConversationId,
          status: "bridge_sent",
          outcome: "bridge_whatsapp",
          closedAt: now,
        })
        .where(and(eq(lcChats.tenantId, tenantId), eq(lcChats.visitorId, visitorId)));
    }

    // 6.3 Criar/reutilizar card no FUNIL CWR → CONTATANDO (Decision 5)
    const cwrResult = await ensureCwrDealOnContacting(tx, {
      tenantId,
      conversationId: waConversationId,
      siteConversationId,
      contactId: contact.id,
      clientName: input.clientName || contact.name,
      companyName: input.companyName,
      actorName: persona.name,
      entryChannelOverride: SITE_CHANNEL,
      campaignOverride: getDefaultSiteCampaignLabel(tenantId),
      isSiteOriginated: true,
    });

    // 6.4 Transferir o ciclo de triagem INCOMPLETA para a conversa do WhatsApp (em `collecting`)
    const [siteFlow] = await tx
      .select()
      .from(agentFlowStates)
      .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, siteFlowId)))
      .for("update")
      .limit(1);

    if (!waPrep.hasActiveHuman) {
      const waFlowId = `fs-sdr-${tenantId}-${waConversationId}`;
      const [existingWaFlow] = await tx
        .select()
        .from(agentFlowStates)
        .where(
          and(
            eq(agentFlowStates.tenantId, tenantId),
            eq(agentFlowStates.conversationId, waConversationId),
            eq(agentFlowStates.agentType, "sdr"),
          ),
        )
        .orderBy(desc(agentFlowStates.startedAt), desc(agentFlowStates.id))
        .limit(1);

      const firstSiteMsgAt = siteMsgs[0]?.sentAt ? new Date(siteMsgs[0].sentAt) : now;
      const inheritedStartedAt = new Date(
        Math.min(
          siteFlow?.startedAt ? new Date(siteFlow.startedAt).getTime() : now.getTime(),
          firstSiteMsgAt.getTime() - 1000,
        ),
      );

      const waFlowMetadata: Record<string, unknown> = {
        ...((existingWaFlow?.metadata as Record<string, unknown>) || {}),
        attendanceActorName: persona.name,
        triagePolicyVersion: INDUSTRIAL_POLICY_VERSION,
        greetingDone: true,
        followUpStage: 0,
        subflow: input.route?.subflow || null,
        funnelStage: input.route?.funnelStage || "triagem",
        targetFunnel: input.route?.targetFunnel || null,
        needsReview: false,
        routeReason: input.route?.reason || "collecting",
        missingFields: [...input.missingFields],
        readyForHandoff: false,
        handoffStatus: "collecting",
        pendingApproval: null,
        originatedFromSiteConversationId: siteConversationId,
        migratedFromSiteMidTriage: true,
        migratedFromSiteMidTriageAt: now.toISOString(),
        siteMidTriageDeliveryMode: deliveryMode,
        siteWhatsappTemplateSent: deliveryMode === "meta_template",
        siteWhatsappTemplateName: usedTemplateName,
        ...(input.siteContext ? { siteContext: input.siteContext } : {}),
        ...(input.vtexLookup ? { vtexLookup: input.vtexLookup } : {}),
        ...(cwrResult.dealId ? { localCrmDealId: cwrResult.dealId } : {}),
        ...(cwrResult.dealTitle ? { localCrmDealTitle: cwrResult.dealTitle } : {}),
      };

      // Mescla dados coletados preservando tudo do site sem perder eventual campo anterior do WA
      const mergedCollectedData: Record<string, unknown> = {
        ...((existingWaFlow?.outcome === "in_progress"
          ? (existingWaFlow.collectedData as Record<string, unknown>)
          : {}) || {}),
        ...input.data,
      };
      const existingPhoneEntry = mergedCollectedData["TELEFONE"] as { value?: string } | undefined;
      if (!existingPhoneEntry?.value) {
        mergedCollectedData["TELEFONE"] = { value: canonicalPhone, status: "filled" };
      }

      if (existingWaFlow && existingWaFlow.outcome === "in_progress") {
        await tx
          .update(agentFlowStates)
          .set({
            collectedData: mergedCollectedData,
            currentStep: "Em Qualificação",
            outcome: "in_progress",
            completedAt: null,
            startedAt: inheritedStartedAt,
            lastInteractionAt: now,
            metadata: waFlowMetadata,
          })
          .where(
            and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, existingWaFlow.id)),
          );
      } else {
        if (existingWaFlow) {
          await tx
            .delete(agentFlowStates)
            .where(
              and(
                eq(agentFlowStates.tenantId, tenantId),
                eq(agentFlowStates.id, existingWaFlow.id),
              ),
            );
        }
        await tx.insert(agentFlowStates).values({
          id: waFlowId,
          tenantId,
          conversationId: waConversationId,
          agentType: "sdr",
          currentStep: "Em Qualificação",
          collectedData: mergedCollectedData,
          metadata: waFlowMetadata,
          startedAt: inheritedStartedAt,
          lastInteractionAt: now,
          completedAt: null,
          outcome: "in_progress",
        });
      }
    } else if (waPrep.conversation.queueState === "meus" && waPrep.conversation.operatorId) {
      await tx
        .update(conversations)
        .set({
          unreadCount: sql`${conversations.unreadCount} + 1`,
          updatedAt: now,
        })
        .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, waConversationId)));
    }

    // 6.5 Encerrar ciclo e conversa do Site
    if (siteFlow) {
      const prevSiteMeta = (siteFlow.metadata as Record<string, unknown>) || {};
      const nextSiteMeta: Record<string, unknown> = {
        ...prevSiteMeta,
        triagePolicyVersion: INDUSTRIAL_POLICY_VERSION,
        subflow: input.route?.subflow || prevSiteMeta.subflow || null,
        funnelStage: input.route?.funnelStage || prevSiteMeta.funnelStage || "triagem",
        targetFunnel: input.route?.targetFunnel || prevSiteMeta.targetFunnel || null,
        handoffStatus: "continued_to_whatsapp",
        whatsappConversationId: waConversationId,
        migratedMidTriage: true,
        siteMidTriageDeliveryMode: deliveryMode,
        siteWhatsappMigrationOfferPending: false,
        siteWhatsappTemplateSent: deliveryMode === "meta_template",
        siteWhatsappTemplateName: usedTemplateName,
        ...(cwrResult.dealId ? { localCrmDealId: cwrResult.dealId } : {}),
        ...(cwrResult.dealTitle ? { localCrmDealTitle: cwrResult.dealTitle } : {}),
      };

      const [updatedSiteFlow] = await tx
        .update(agentFlowStates)
        .set({
          collectedData: input.data,
          currentStep: "Continuado no WhatsApp",
          outcome: "transferred",
          completedAt: now,
          lastInteractionAt: now,
          metadata: nextSiteMeta,
        })
        .where(and(eq(agentFlowStates.tenantId, tenantId), eq(agentFlowStates.id, siteFlow.id)))
        .returning();

      if (updatedSiteFlow) {
        await appendIndustrialJournal(
          tx,
          siteFlow,
          updatedSiteFlow,
          "continuity",
          `site-mid-wa:${cycle}`,
        );
      }
    }

    const [closedSiteConv] = await tx
      .update(conversations)
      .set({
        queueState: "finalizados",
        unreadCount: 0,
        updatedAt: now,
        version: sql`${conversations.version} + 1`,
      })
      .where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, siteConversationId)))
      .returning();

    return {
      cwrResult,
      insertedMirrors,
      insertedNote: insertedNote || null,
      closedSiteConv: closedSiteConv || null,
    };
  });

  // 7. Notificações SSE em tempo real para o painel do operador e Kanban SDR
  try {
    const sm = SessionManager.getInstance();
    for (const m of committed.insertedMirrors) {
      sm.notifyPublic(tenantId, {
        type: "message",
        message: {
          ...m,
          queue: waPrep.hasActiveHuman ? waPrep.conversation.queueState : "automacao",
          operatorId: waPrep.hasActiveHuman ? waPrep.conversation.operatorId : null,
        },
      });
    }
    if (committed.insertedNote) {
      sm.notifyPublic(tenantId, {
        type: "message",
        message: {
          ...committed.insertedNote,
          queue: waPrep.hasActiveHuman ? waPrep.conversation.queueState : "automacao",
          operatorId: waPrep.hasActiveHuman ? waPrep.conversation.operatorId : null,
        },
      });
    }
    if (committed.closedSiteConv) {
      sm.notifyPublic(tenantId, {
        type: "queue_update",
        conversationId: siteConversationId,
        queueState: "finalizados",
        operatorId: null,
        unreadCount: 0,
        version: committed.closedSiteConv.version,
      });
    }
    sm.notifyPublic(tenantId, {
      type: "sdr_flow_updated",
      conversationId: waConversationId,
      funnelStage: input.route?.funnelStage || "triagem",
      targetFunnel: input.route?.targetFunnel || null,
      outcome: "in_progress",
      handoffStatus: "collecting",
    });
  } catch {
    // Falha silenciosa em SSE
  }

  return {
    migrated: true,
    deliveryMode,
    whatsappConversationId: waConversationId,
    dealId: committed.cwrResult.dealId || null,
    dealTitle: committed.cwrResult.dealTitle || null,
    templateName: usedTemplateName,
    closingMessageForSite,
    preservedHumanOperator: waPrep.hasActiveHuman,
  };
}
