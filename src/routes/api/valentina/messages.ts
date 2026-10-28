import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import {
  internalMessages,
  conversations,
  messages,
  contacts,
  operators,
  responseTimeLogs,
  operatorDailyMetrics,
  aiConversationAudits,
  agentFlowStates,
  crmDeals,
  crmStages,
  crmPipelines,
  crmAccounts,
  crmStageSettings,
  crmDealActivities,
  crmDealContacts,
  crmConversationDeals,
  crmCustomFieldDefinitions,
  crmDealProducts,
  crmProposals,
  crmDealFiles,
  crmDealQuestionnaires,
  crmDealEmails,
  crmDealEvents,
  crmActivityMessages,
  tasks,
} from "../../../db/schema";
import { eq, and, desc, asc, sql, gte, isNull, ne, count, or, inArray, ilike } from "drizzle-orm";
import crypto from "crypto";
import { getAiPersona } from "../../../lib/ai-persona";
import { requireSession } from "../../../lib/auth-session";
import { getCommercialHome } from "../../../lib/commercial/home-service";
import {
  getKnowledgeBaseContext,
  isExplicitMachinePhotoRequest,
  isMultiOrFamilyMachinePhotoRequest,
  findCatalogPhotosInFragment,
  getModelToInternalCodeMap,
  resolveMatchingCatalogPhotos,
  resolveCatalogPhotosByMediaUrls,
  resolveKnowledgeSourcesForMessage,
  type MatchedCatalogPhoto,
} from "../../../lib/valentina/knowledge-service";
import { getDirectorBiContext } from "../../../lib/valentina/director-bi-context";
import {
  resolveSystemGuideForQuery,
  getCompactSystemNavigationCheatSheet,
} from "../../../lib/valentina/system-guide-service";
import {
  lookupVtexProductsForAssistant,
  isVtexOrProductAssistantQuery,
  type VtexAssistantLookupResult,
} from "../../../lib/valentina/vtex-assistant-service";
import {
  fieldAppliesToPipeline,
  formatCustomFieldLabel,
  isFilled,
  parseJsonArray,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from "../../../lib/crm/custom-fields";
import {
  buildAgenticThoughtTrace,
  isCasualConversationQuery,
  type AgenticThoughtStep,
  type AgenticThoughtTraceData,
} from "../../../lib/valentina/agentic-thought-trace";
import { SessionManager } from "../../../lib/baileys/session-manager";
import type { MultimodalPart } from "../../../lib/vertex-ai";
import type {
  RelatedConversationItem,
  RelatedDealItem,
  RelatedCallActionItem,
  VtexProductPreviewItem,
  KnowledgeSourceItem,
} from "../../../lib/mockData";

// ── Emissor de Telemetria Real via SSE para a Árvore Agêntica ────────────────
function emitRealTimeThoughtProgress(params: {
  tenantId: string;
  operatorId: string;
  scope: "admin" | "operator";
  taskTitle: string;
  finishedTitle?: string;
  startedAtMs?: number;
  steps: AgenticThoughtStep[];
}) {
  try {
    const safeTaskTitle =
      typeof params.taskTitle === "string" && params.taskTitle.trim().length > 0
        ? params.taskTitle
        : "Processando solicitação...";
    const safeFinishedTitle =
      typeof params.finishedTitle === "string" && params.finishedTitle.trim().length > 0
        ? params.finishedTitle
        : "Consulta concluída";
    const safeSteps = Array.isArray(params.steps)
      ? params.steps.filter(
          (s): s is AgenticThoughtStep =>
            Boolean(s && typeof s === "object" && typeof s.id === "string" && typeof s.actionVerb === "string")
        )
      : [];
    const startedMs = typeof params.startedAtMs === "number" ? params.startedAtMs : Date.now();
    const trace: AgenticThoughtTraceData = {
      taskTitle: safeTaskTitle,
      finishedTitle: safeFinishedTitle,
      totalDurationSeconds: Math.max(1, Math.round((Date.now() - startedMs) / 1000)),
      scope: params.scope,
      isRealTimeStream: true,
      steps: safeSteps,
    };
    SessionManager.getInstance().notifyPublic(params.tenantId, {
      type: "valentina_thought_progress",
      tenantId: params.tenantId,
      operatorId: params.operatorId,
      scope: params.scope,
      trace,
    });
  } catch {}
}

// ── Headers CORS padrão ──────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Extrai texto de arquivo anexado (PDF, DOCX, XLSX, TXT) ──────────────────
async function extractFileText(name: string, mimeType: string, base64: string): Promise<string> {
  const buf = Buffer.from(base64, "base64");
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  if (mimeType === "text/plain" || ext === "txt") {
    return buf.toString("utf-8").slice(0, 12000);
  }
  if (mimeType === "application/pdf" || ext === "pdf") {
    try {
      const pdfParse = await import("pdf-parse");
      const pdfFn = (pdfParse as any).default || pdfParse;
      const result = await pdfFn(buf);
      return result.text.slice(0, 12000);
    } catch {
      return `[PDF recebido: ${name} — conteúdo não extraído automaticamente]`;
    }
  }
  if (mimeType.includes("wordprocessingml") || mimeType.includes("msword") || ext === "docx" || ext === "doc") {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value.slice(0, 12000);
    } catch {
      return `[Documento Word recebido: ${name} — conteúdo não extraído automaticamente]`;
    }
  }
  if (mimeType.includes("spreadsheetml") || mimeType.includes("ms-excel") || ext === "xlsx" || ext === "xls") {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "buffer" });
      const texts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        texts.push(`[Planilha: ${sheetName}]\n${csv}`);
      }
      return texts.join("\n\n").slice(0, 12000);
    } catch {
      return `[Planilha Excel recebida: ${name} — conteúdo não extraído automaticamente]`;
    }
  }
  return `[Arquivo recebido: ${name}]`;
}

// ── Resolve nome do operador pelo ID ────────────────────────────────────────
async function getOperatorName(operatorId: string): Promise<string> {
  try {
    const [op] = await db
      .select({ name: operators.name })
      .from(operators)
      .where(eq(operators.id, operatorId))
      .limit(1);
    return op?.name || "Operador";
  } catch {
    return "Operador";
  }
}

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

const STOPWORDS_PT = new Set([
  "como", "qual", "quais", "quem", "onde", "quando", "porque", "para", "pelo", "pela",
  "meus", "minha", "minhas", "meu", "sobre", "estao", "esta", "estão", "está", "hoje",
  "ontem", "amanha", "amanhã", "agora", "fagner", "valentina", "cliente", "clientes",
  "negociacao", "negociação", "negociacoes", "negociações", "tarefa", "tarefas",
  "ligacao", "ligação", "ligacoes", "ligações", "meta", "metas", "conversa", "conversas",
  "atendimento", "atendimentos", "tenho", "tem", "tudo", "todos", "todas", "fazer",
  "preciso", "quero", "pode", "resumo", "status", "parada", "paradas", "parado", "parados",
  "aberta", "abertas", "aberto", "abertos", "pendente", "pendentes", "agenda", "agendada",
  "agendadas", "agendado", "agendados", "mes", "mês", "semana", "dia", "valor", "proposta",
  "outra", "outras", "outro", "outros", "mais", "algum", "alguma", "alguns", "algumas",
  "liste", "listar", "lista", "completa", "completo", "nome", "carteira", "mensure",
  "mensurar", "mensuracao", "mensuração", "quantidade", "quantas", "quantos", "total", "totais",
  "arquivo", "anexado", "enviado", "foto", "fotos", "imagem", "imagens", "print", "anexo",
  "que", "informacao", "informacoes", "informação", "informações", "dado", "dados",
  "dessa", "dessas", "desse", "desses", "dela", "delas", "dele", "deles", "nela", "nelas",
  "nele", "neles", "nessa", "nessas", "nesse", "nesses", "disse", "falou", "possui",
  "possuo", "voce", "você", "nao", "não", "sim", "campo", "campos", "customizado",
  "customizados", "personalizado", "personalizados", "preenchido", "preenchidos",
  "preenchida", "preenchidas", "registrado", "registrados", "registrada", "registradas",
  "cadastrado", "cadastrados", "cadastrada", "cadastradas", "card", "cards", "ficha",
  "historico", "histórico", "detalhe", "detalhes",
]);

function stripAttachmentTagsFromQuery(raw?: string): string {
  if (!raw) return "";
  return raw
    .replace(/\[LOCAL_MEDIA:[^\]]+\]/gi, " ")
    .replace(/\[Arquivo\s+(?:anexado|enviado):\s*[^\]]+\]/gi, " ")
    .replace(/\[Imagem\s+enviada:\s*[^\]]+\]/gi, " ")
    .trim();
}

function extractSearchCandidateTerms(userQuery?: string): string[] {
  const cleaned = stripAttachmentTagsFromQuery(userQuery);
  if (!cleaned) return [];
  return cleaned
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS_PT.has(w))
    .slice(0, 4);
}

function extractPhoneFromCustomFields(cf: any): string | null {
  if (!cf || typeof cf !== "object") return null;
  for (const [k, v] of Object.entries(cf)) {
    if (typeof v === "string" && /fone|tel|cel|whats|contato/i.test(k)) {
      const digits = v.replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 13) return v.trim();
    }
  }
  return null;
}

function normalizeForMatch(value?: string | null): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDateTimeBrt(raw?: Date | string | null): string {
  if (!raw) return "N/A";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "N/A";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnlyBrt(raw?: Date | string | null): string {
  if (!raw) return "N/A";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatContactRoleLabel(role?: string | null): string {
  const norm = (role || "buyer").toLowerCase().trim();
  switch (norm) {
    case "buyer":
      return "COMPRADOR";
    case "decision_maker":
      return "DECISOR";
    case "technical":
      return "TÉCNICO";
    case "influencer":
      return "INFLUENCIADOR";
    case "financial":
      return "FINANCEIRO";
    case "user":
      return "USUÁRIO";
    default:
      return norm.toUpperCase() || "COMPRADOR";
  }
}

interface DecodedCustomFieldsResult {
  filled: Array<{ name: string; valueLabel: string; fieldId: string }>;
  empty: Array<{ name: string; fieldId: string }>;
  inlineSummary: string;
}

function decodeCustomFieldsForEntity(
  allDefs: CustomFieldDefinition[],
  entityType: CustomFieldEntity,
  rawCustomFields: unknown,
  pipelineId?: string | null
): DecodedCustomFieldsResult {
  const raw =
    rawCustomFields && typeof rawCustomFields === "object" && !Array.isArray(rawCustomFields)
      ? (rawCustomFields as Record<string, unknown>)
      : {};

  const entityDefs = allDefs.filter((def) => def.entityType === entityType);
  const applicableDefs =
    entityType === "deal"
      ? entityDefs.filter((def) => fieldAppliesToPipeline(def, pipelineId))
      : entityDefs;

  const filled: Array<{ name: string; valueLabel: string; fieldId: string }> = [];
  const empty: Array<{ name: string; fieldId: string }> = [];
  const usedRawKeys = new Set<string>();

  for (const def of applicableDefs) {
    let val: unknown = undefined;
    if (Object.prototype.hasOwnProperty.call(raw, def.id) && isFilled(raw[def.id])) {
      val = raw[def.id];
      usedRawKeys.add(def.id);
    } else if (Object.prototype.hasOwnProperty.call(raw, def.name) && isFilled(raw[def.name])) {
      val = raw[def.name];
      usedRawKeys.add(def.name);
    }

    if (isFilled(val)) {
      const label = formatCustomFieldLabel(def, val) || String(val);
      filled.push({ name: def.name, valueLabel: label, fieldId: def.id });
    } else {
      empty.push({ name: def.name, fieldId: def.id });
    }
  }

  // Também decodifica qualquer campo preenchido cuja chave não estava no filtro do pipeline (ou chaves avulsas)
  const defByIdOrName = new Map<string, CustomFieldDefinition>();
  for (const def of entityDefs) {
    defByIdOrName.set(def.id, def);
    defByIdOrName.set(def.name.toLowerCase(), def);
  }

  for (const [k, v] of Object.entries(raw)) {
    if (usedRawKeys.has(k) || !isFilled(v)) continue;
    const matchedDef = defByIdOrName.get(k) || defByIdOrName.get(k.toLowerCase());
    if (matchedDef) {
      const label = formatCustomFieldLabel(matchedDef, v) || String(v);
      filled.push({ name: matchedDef.name, valueLabel: label, fieldId: matchedDef.id });
    } else {
      const label = Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
      filled.push({ name: k, valueLabel: label, fieldId: k });
    }
  }

  const inlineSummary = filled.map((f) => `${f.name}: ${f.valueLabel}`).join(" | ");
  return { filled, empty, inlineSummary };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXTO DO COPILOTO DO VENDEDOR/OPERADOR — Dados exclusivos do próprio operador
// Usado em: Módulo de Chat (fixado na lista), scope = "operator"
// RBAC ESTRITO: Filtra 100% por tenantId + operatorId. Bloqueia dados de terceiros/diretoria.
// ═══════════════════════════════════════════════════════════════════════════════
export interface OperatorContextResult {
  contextText: string;
  knownConversations: RelatedConversationItem[];
  waitingConversations: RelatedConversationItem[];
  todayLeadsConversations: RelatedConversationItem[];
  knownDeals: RelatedDealItem[];
  scheduledCallActions: RelatedCallActionItem[];
  executedSteps: AgenticThoughtStep[];
  taskTitle: string;
  finishedTitle: string;
  isCasual: boolean;
  isThirdPartyBlocked: boolean;
  isPureKbQuery?: boolean;
  isSystemGuideQuery?: boolean;
  vtexLookupResult?: VtexAssistantLookupResult | null;
  systemGuideSources?: KnowledgeSourceItem[];
}

async function getOperatorContext(
  tenantId: string,
  operatorId: string,
  operatorEmail?: string | null,
  userQuery?: string,
  recentAiContextText?: string,
  onProgress?: (steps: AgenticThoughtStep[], taskTitle: string, finishedTitle: string) => void,
  hasAttachedImage?: boolean,
  imageFileName?: string,
  recentDealIdsFromHistory?: string[]
): Promise<OperatorContextResult> {
  const sections: string[] = [];
  const knownConvMap = new Map<string, RelatedConversationItem>();
  const waitingConversations: RelatedConversationItem[] = [];
  const todayLeadsConversations: RelatedConversationItem[] = [];
  const knownDealMap = new Map<string, RelatedDealItem>();
  const scheduledCallActions: RelatedCallActionItem[] = [];
  const executedSteps: AgenticThoughtStep[] = [];
  let isThirdPartyBlocked = false;

  const cleanUserQuery = stripAttachmentTagsFromQuery(userQuery || "");
  const isCasual = !hasAttachedImage && isCasualConversationQuery(cleanUserQuery);
  if (isCasual) {
    return {
      contextText:
        "💬 MENSAGEM CASUAL / CONFIRMAÇÃO RÁPIDA DO VENDEDOR: Responda em 1 único balão curto e natural (máximo 1 frase), sem listar negociações, sem sugerir clientes e mantendo os arrays mentionedDealIds, suggestedCallDealIds e mentionedConversationIds vazios ([]).",
      knownConversations: [],
      waitingConversations: [],
      todayLeadsConversations: [],
      knownDeals: [],
      scheduledCallActions: [],
      executedSteps: [],
      taskTitle: "Respondendo mensagem",
      finishedTitle: "Resposta direta enviada",
      isCasual: true,
      isThirdPartyBlocked: false,
      isPureKbQuery: false,
    };
  }

  const q = normalizeForMatch(cleanUserQuery);
  const normRecentAiForIntent = normalizeForMatch(recentAiContextText || "");
  const primaryTerms = extractSearchCandidateTerms(cleanUserQuery);
  const isFollowUpRequest =
    /\b(?:puxe|puxar|detalhe|detalhes|link|botao|abrir|abre|ela|elas|essa|essas|esse|esses|dela|delas|dele|deles|dessa|dessas|desse|desses|nela|nelas|nele|neles|nessa|nessas|nesse|nesses|recomende|especifico|fechar\s+hoje|ligar|outra|outras|outro|outros|lista\s+completa|todas|todos|campo|campos|customizado|customizados|personalizado|personalizados|preenchido|preenchidos|informacao|informacoes|dado|dados|ficha|historico|nota|notas|atividade|atividades|produto|produtos|questionario|arquivo|arquivos|email|comprador|sdr|volume|criado|criada|atualizado|atualizada|fechamento|previsao|preco|valor|site|vtex|pagina)\b/i.test(
      q
    );

  const isExplicitPhotoRequest = isExplicitMachinePhotoRequest(
    cleanUserQuery || userQuery || "",
    Boolean(hasAttachedImage)
  );

  // Detecção de dúvidas sobre o uso do sistema (Onboarding Wizard) e consultas VTEX
  const systemGuideMatch = resolveSystemGuideForQuery(
    cleanUserQuery || userQuery || "",
    recentAiContextText || ""
  );
  const vtexIntent = isVtexOrProductAssistantQuery(
    cleanUserQuery || userQuery || "",
    recentAiContextText || ""
  );

  // Classificação de intenção real para consultar apenas o que é necessário
  const hasExplicitMachineOrManualKeyword =
    Boolean(hasAttachedImage) ||
    isExplicitPhotoRequest ||
    vtexIntent.shouldQueryVtex ||
    /\b(?:maquina|maquinas|equipamento|equipamentos|modelo|modelos|manual|manuais|especificac|catalogo|voltagem|potencia|seladora|selar|selagem|envasadora|envasar|envase|rotuladora|rotular|rotulagem|datador|datar|datacao|empacotadora|empacotar|dosadora|dosar|valvula|frasco|frascos|pote|potes|garrafa|garrafas|tampa|tampas|alicate|arqueadora|arquear|arqueacao|fita|peca|pecas|tunel|encolhimento|vacuo|sache|saches|encapsuladora|encapsular|blister|cartonadora|enfardad|fechadora|stretch|inkjet|laser|ribbon|teflon|resistencia|ihm|clp|inversor|bomba|rotor|pistao|bico|bicos|dosag|velocidade|temperatura|compressor|pneumatic|eletric|dimens|plastico|salgadinho|salgadinhos|embalar|embalagem|embalagens|pacote|pacotes|saco|sacos|bandeja|bandejas|por\s+minuto|ciclos|ficha\s+tecnica|como\s+funciona|o\s*que\s+sabe\s+sobre|me\s+fal[ae]\s+sobre|vtex|sku\s*\d+)\b/.test(
      q
    ) ||
    /\b[a-z]{1,6}[-_\s]?\d{1,5}(?:[-_\s]?[a-z0-9]{1,5})*\b/i.test(cleanUserQuery || userQuery || "");

  const isRecentMachineManualTurn =
    /\b(?:puxei\s+as\s+informacoes\s+do\s+manual|segundo\s+o\s+manual|segundo\s+o\s+catalogo|linha\s+personnalite|linha\s+semi-industrial|faixa\s+de\s+dosagem|range\s+de\s+dosagem|embalagens\s+por\s+hora|ciclos\s+por\s+minuto|componentes\s+pneumaticos|alimentacao\s+eletrica|manual\s+tecnico|painel\s+de\s+controle|ihm\s+touch|volume\s+de\s+envase|velocidade\s+da\s+esteira|tempo\s+entre\s+os\s+ciclos|nao,\s+essa\s+maquina\s+nao\s+serve|envasadora|seladora|dosadora|rotuladora|datador|empacotadora|arqueadora|encapsuladora|pamq[a-z0-9]+|tecfag\.com\.br|loja\s+vtex)\b/.test(
      normRecentAiForIntent
    );

  const isMachineContext = hasExplicitMachineOrManualKeyword || isRecentMachineManualTurn;

  const isOverviewOrGeneral =
    !isMachineContext &&
    !systemGuideMatch.isSystemHowTo &&
    /\b(?:resumo|panorama|geral|tudo|meu dia|como estou|prioridade|prioridades|bom dia|boa tarde|boa noite|oi|ola)\b/.test(
      q
    );
  const isCallOrPhone =
    !systemGuideMatch.isSystemHowTo &&
    /\b(?:ligar|ligacao|ligacoes|telefone|fone|celular|contato|vigos|discar)\b/.test(q);
  const isWaitingChat =
    !systemGuideMatch.isSystemHowTo &&
    /\b(?:esperando|aguardando|fila|conversa|conversas|chat|whatsapp|responder|atraso|sla|lead|leads|chegaram|chegou|hoje|caixa\s+de\s+entrada)\b/.test(
      q
    );
  const hasExplicitCrmEntityWord =
    !systemGuideMatch.isSystemHowTo &&
    /\b(?:negociac|card|cards|crm|proposta|orcamento|funil|etapa|carteira|pipeline|venda|vendas|mensur|campo|campos|customizado|customizados|personalizado|personalizados|preenchido|preenchidos|comprador|sdr|questionario|email|cnpj|cpf)\b/.test(
      q
    );
  const isPureWaitingQueueQuery =
    !systemGuideMatch.isSystemHowTo &&
    /\b(?:esperando|aguardando|fila|caixa\s+de\s+entrada|sem\s+resposta)\b/.test(q) &&
    !hasExplicitCrmEntityWord;
  const hasStrictCrmKeyword =
    !systemGuideMatch.isSystemHowTo &&
    (hasExplicitCrmEntityWord ||
      (!isPureWaitingQueueQuery &&
        !isMachineContext &&
        /\b(?:parada|paradas|parado|parados|esfriando|aberta|abertas|perdida|perdidas|ganha|ganhas|pausada|pausadas|cliente|clientes|empresa|empresas|fechar)\b/.test(
          q
        )));
  const hasBroadCrmModifier =
    !isMachineContext &&
    !isPureWaitingQueueQuery &&
    !systemGuideMatch.isSystemHowTo &&
    /\b(?:valor|outra|outras|outro|outros|lista|listar|liste|todas|todos|quantas|quantos)\b/.test(
      q
    );
  const hasExplicitCrmKeyword = hasStrictCrmKeyword || hasBroadCrmModifier;

  const isDealOrCrm =
    !systemGuideMatch.isSystemHowTo &&
    (hasExplicitCrmKeyword ||
      (!isMachineContext &&
        !isPureWaitingQueueQuery &&
        /\b(?:informacao|informacoes|ficha|volume|produto|produtos|arquivo|arquivos)\b/.test(q)));
  const isGoalOrMeta =
    !systemGuideMatch.isSystemHowTo &&
    /\b(?:meta|metas|ritmo|pacing|falta|vendi|ganh|comiss|faturamento|diretriz)\b/.test(q);
  const isTaskOrAgenda =
    !systemGuideMatch.isSystemHowTo &&
    /\b(?:tarefa|tarefas|agenda|compromisso|reuniao|reunioes|pendente|atrasad|follow)\b/.test(q);
  const isMetricsQuery =
    !systemGuideMatch.isSystemHowTo &&
    /\b(?:metrica|metricas|tma|tempo medio|tempo de resposta|score|nota|desempenho)\b/.test(q);
  const isKbQuery =
    hasExplicitMachineOrManualKeyword ||
    (isFollowUpRequest && isRecentMachineManualTurn && !hasStrictCrmKeyword);
  const isPureKbQuery =
    (isKbQuery || systemGuideMatch.isSystemHowTo) &&
    !isDealOrCrm &&
    !isWaitingChat &&
    !isGoalOrMeta &&
    !isCallOrPhone &&
    !isTaskOrAgenda &&
    !isOverviewOrGeneral;

  let taskTitle = "Consultando dados da sua operação";
  let finishedTitle = "Consulta comercial concluída";

  if (systemGuideMatch.isSystemHowTo && !isKbQuery) {
    taskTitle = "Consultando Guia Oficial do Sistema (Onboarding Wizard)";
    finishedTitle = "Passo a passo de navegação do sistema carregado";
  } else if (vtexIntent.shouldQueryVtex) {
    taskTitle = "Consultando Loja VTEX ao vivo, lendo página do produto e manual técnico";
    finishedTitle = "Leitura da página VTEX e manual técnico concluída";
  } else if (hasAttachedImage && !isDealOrCrm && !isWaitingChat && !isGoalOrMeta) {
    taskTitle = "Inspecionando visualmente a foto enviada e consultando catálogo técnico";
    finishedTitle = "Inspeção visual e consulta técnica concluídas";
  } else if (isExplicitPhotoRequest && !isDealOrCrm) {
    taskTitle = "Localizando foto do equipamento no Catálogo e Base de Conhecimento";
    finishedTitle = "Foto do equipamento localizada no Catálogo";
  } else if (isPureKbQuery) {
    taskTitle = "Consultando manuais técnicos e catálogo na Base de Conhecimento (RAG)";
    finishedTitle = "Consulta aos manuais técnicos e catálogo concluída";
  } else if (isPureWaitingQueueQuery) {
    taskTitle = "Verificando clientes aguardando resposta na sua fila";
    finishedTitle = "Inspeção da sua fila de atendimento concluída";
  } else if (isCallOrPhone) {
    taskTitle = "Localizando telefones e preparando ações de ligação";
    finishedTitle = "Telefones e atalhos de discagem localizados";
  } else if (isDealOrCrm || isFollowUpRequest || primaryTerms.length > 0) {
    taskTitle = "Consultando negociações, campos personalizados e ficha completa no CRM";
    finishedTitle = "Análise completa da carteira e campos do CRM concluída";
  } else if (isGoalOrMeta) {
    taskTitle = "Calculando atingimento da sua meta mensal e ritmo";
    finishedTitle = "Cálculo de meta e pacing comercial concluído";
  } else if (isTaskOrAgenda) {
    taskTitle = "Verificando suas tarefas, ligações e agenda do dia";
    finishedTitle = "Verificação de agenda e tarefas concluída";
  } else if (isWaitingChat) {
    taskTitle = "Verificando clientes aguardando resposta na sua fila";
    finishedTitle = "Inspeção da sua fila de atendimento concluída";
  }

  const shouldRunGoals =
    !hasAttachedImage &&
    !isPureKbQuery &&
    !systemGuideMatch.isSystemHowTo &&
    (isOverviewOrGeneral || isGoalOrMeta || (!isCallOrPhone && !isWaitingChat && !isTaskOrAgenda && primaryTerms.length === 0));
  const shouldRunDeals =
    !isPureKbQuery &&
    !isPureWaitingQueueQuery &&
    !systemGuideMatch.isSystemHowTo &&
    (isOverviewOrGeneral || isDealOrCrm || isCallOrPhone || isFollowUpRequest || (!hasAttachedImage && (primaryTerms.length > 0 || !isWaitingChat)));
  const shouldRunTasks =
    !isPureKbQuery && !systemGuideMatch.isSystemHowTo && (isOverviewOrGeneral || isTaskOrAgenda || isCallOrPhone);
  const shouldRunChats =
    !isPureKbQuery &&
    !systemGuideMatch.isSystemHowTo &&
    (isOverviewOrGeneral || isWaitingChat || isCallOrPhone || (!hasAttachedImage && primaryTerms.length > 0) || isFollowUpRequest);
  const shouldRunMetrics = !isPureKbQuery && !systemGuideMatch.isSystemHowTo && (isOverviewOrGeneral || isMetricsQuery);
  const shouldRunKb = isKbQuery || Boolean(hasAttachedImage) || vtexIntent.shouldQueryVtex;

  const pushRealStep = (step: AgenticThoughtStep) => {
    executedSteps.push(step);
    onProgress?.([...executedSteps], taskTitle, finishedTitle);
  };

  pushRealStep({
    id: "step-op-thought-1",
    kind: "thought",
    actionVerb: "Pensou por 1s",
    targetLabel: hasAttachedImage
      ? "Preparando análise visual multimodal da foto e busca no catálogo técnico"
      : isPureKbQuery
      ? "Localizando manual técnico e especificações do equipamento na Base de Conhecimento"
      : "Selecionando consultas necessárias para responder à sua pergunta",
    durationSeconds: 1,
    detailText: hasAttachedImage
      ? `Iniciando leitura óptica da imagem${imageFileName ? ` ("${imageFileName}")` : ""} e verificação na Base de Conhecimento.`
      : isPureKbQuery
      ? `Analisando "${(cleanUserQuery || userQuery || "").slice(0, 80)}" nos manuais técnicos (PDF) e no Catálogo Oficial de Máquinas.`
      : `Analisando "${(cleanUserQuery || userQuery || "").slice(0, 80)}" para consultar e mensurar todas as tabelas relevantes da sua carteira.`,
  });

  try {
    // ── 1. META DO MÊS, RITMO (PACING) E DIRETRIZES DO GESTOR ────────────────
    if (shouldRunGoals) {
      const t0 = Date.now();
      try {
        const home = await getCommercialHome(tenantId, operatorId);
        const homeMs = Math.max(12, Date.now() - t0);
        const g = home.goal;
        if (g.configured && g.targetValue > 0) {
          const statusRitmo =
            g.coveragePercent >= g.expectedPercent
              ? "✅ Acima/Dentro do ritmo esperado"
              : "⚠️ Abaixo do ritmo esperado para o dia";
          const faltaValor = Math.max(0, g.targetValue - g.realizedValue);
          sections.push(
            `🎯 SUA META COMERCIAL DO MÊS (${home.month}):\n` +
              `  • Meta Mensal: ${formatBrl(g.targetValue)}\n` +
              `  • Realizado (Ganhos no mês): ${formatBrl(g.realizedValue)} (${g.coveragePercent.toFixed(1)}% da meta | ${home.deals.wonThisMonthCount} venda(s) ganha(s))\n` +
              `  • Falta para bater a meta: ${formatBrl(faltaValor)}\n` +
              `  • Ritmo esperado até hoje (${home.today}): ${g.expectedPercent.toFixed(1)}% (${g.elapsedDays} de ${g.businessDays} dias úteis decorridos | restam ${g.remainingDays} dias úteis)\n` +
              `  • Status do Ritmo: ${statusRitmo}\n` +
              `  • Meta diária necessária nos próximos dias úteis: ${formatBrl(g.dailyRequired)}/dia\n` +
              `  • Pipeline em aberto: ${home.deals.openCount} negociação(ões) somando ${formatBrl(home.deals.openValue)}`
          );
        } else {
          sections.push(
            `🎯 SUA META COMERCIAL DO MÊS (${home.month}):\n` +
              `  • Meta mensal ainda não cadastrada pelo gestor para este mês.\n` +
              `  • Realizado no mês: ${formatBrl(g.realizedValue)} (${home.deals.wonThisMonthCount} venda(s) ganha(s))\n` +
              `  • Pipeline em aberto: ${home.deals.openCount} negociação(ões) somando ${formatBrl(home.deals.openValue)}`
          );
        }

        if (home.wonDeals.length > 0) {
          const wonLines = home.wonDeals
            .slice(0, 8)
            .map((w) => `  • 🏆 ${w.title} — ${formatBrl(w.value)} (fechado em ${w.closedAt ? new Date(w.closedAt).toLocaleDateString("pt-BR") : "N/A"})`)
            .join("\n");
          sections.push(`🏆 SUAS VENDAS GANHAS NESTE MÊS (${home.wonDeals.length}):\n${wonLines}`);
        }

        const pendingDirectives = home.directives.filter((d) => d.status === "pending");
        if (pendingDirectives.length > 0) {
          const dirLines = pendingDirectives
            .slice(0, 10)
            .map(
              (d) =>
                `  • [${d.priority.toUpperCase()}${d.overdue ? " | 🚨 ATRASADA" : ""}] Negociação "${d.dealTitle}" (${formatBrl(d.dealValue)} - Etapa: ${d.stageName || "N/A"}): "${d.instruction}"`
            )
            .join("\n");
          sections.push(`📌 DIRETRIZES DO GESTOR PARA VOCÊ (${pendingDirectives.length} pendente(s)):\n${dirLines}`);
        }

        pushRealStep({
          id: "step-op-home",
          kind: "query",
          actionVerb: "Consultou",
          targetLabel: "getCommercialHome",
          scopeTag: `#meta-e-pacing • ${homeMs}ms`,
          badgeType: "crm",
          detailText: `Meta mensal, realizado (${formatBrl(g.realizedValue)}) e ${home.deals.openCount} negociações no pipeline verificados em ${homeMs}ms.`,
        });
      } catch (homeErr: any) {
        console.warn("[getOperatorContext] Aviso ao carregar getCommercialHome:", homeErr?.message);
      }
    }

    // ── 2. NEGOCIAÇÕES (CRM DEALS) — VISIBILIDADE E MENSURAÇÃO 100% DA CARTEIRA + CAMPOS PERSONALIZADOS ──
    const enrichedDealByIdMap = new Map<string, any>();
    let allCustomFieldDefs: CustomFieldDefinition[] = [];

    if (shouldRunDeals) {
      const tDeals0 = Date.now();
      try {
        // Executa em paralelo a leitura de TODAS as negociações do operador + contatos vinculados + conversas vinculadas + definições de campos personalizados
        const [operatorDeals, dcRows, convLinks, rawCfDefs] = await Promise.all([
          db
            .select({
              id: crmDeals.id,
              title: crmDeals.title,
              status: crmDeals.status,
              value: crmDeals.value,
              currency: crmDeals.currency,
              stageId: crmDeals.stageId,
              stageName: crmStages.name,
              pipelineId: crmDeals.pipelineId,
              pipelineName: crmPipelines.name,
              pipelineCoolingDays: crmPipelines.coolingDays,
              stageCoolingDays: crmStageSettings.coolingDays,
              stageCoolingEnabled: crmStageSettings.coolingEnabled,
              accountId: crmDeals.accountId,
              accountType: crmAccounts.type,
              accountName: crmAccounts.name,
              accountTradeName: crmAccounts.tradeName,
              accountSegment: crmAccounts.segment,
              accountDocumentType: crmAccounts.documentType,
              accountDocument: crmAccounts.document,
              accountPhone: crmAccounts.phone,
              accountEmail: crmAccounts.email,
              accountWebsite: crmAccounts.website,
              accountAddress: crmAccounts.address,
              accountCustomFields: crmAccounts.customFields,
              accountNotes: crmAccounts.notes,
              source: crmDeals.source,
              campaign: crmDeals.campaign,
              rating: crmDeals.rating,
              lossReason: crmDeals.lossReason,
              pausedReason: crmDeals.pausedReason,
              rdDealId: crmDeals.rdDealId,
              rdDealUrl: crmDeals.rdDealUrl,
              customFields: crmDeals.customFields,
              expectedCloseDate: crmDeals.expectedCloseDate,
              lastActivityAt: crmDeals.lastActivityAt,
              closedAt: crmDeals.closedAt,
              updatedAt: crmDeals.updatedAt,
              createdAt: crmDeals.createdAt,
            })
            .from(crmDeals)
            .leftJoin(crmStages, and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.tenantId, tenantId)))
            .leftJoin(crmPipelines, and(eq(crmPipelines.id, crmDeals.pipelineId), eq(crmPipelines.tenantId, tenantId)))
            .leftJoin(crmAccounts, and(eq(crmAccounts.id, crmDeals.accountId), eq(crmAccounts.tenantId, tenantId)))
            .leftJoin(
              crmStageSettings,
              and(eq(crmStageSettings.stageId, crmDeals.stageId), eq(crmStageSettings.tenantId, tenantId))
            )
            .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.operatorId, operatorId)))
            .orderBy(desc(crmDeals.updatedAt)),
          db
            .select({
              dealId: crmDealContacts.dealId,
              role: crmDealContacts.role,
              isPrimary: crmDealContacts.isPrimary,
              contactId: contacts.id,
              contactName: contacts.name,
              contactPhone: contacts.phone,
              contactEmail: contacts.email,
              contactCnpj: contacts.cnpj,
              contactCpf: contacts.cpf,
              contactTags: contacts.tags,
              contactCustomFields: contacts.customFields,
            })
            .from(crmDealContacts)
            .innerJoin(
              crmDeals,
              and(eq(crmDeals.id, crmDealContacts.dealId), eq(crmDeals.tenantId, tenantId))
            )
            .innerJoin(
              contacts,
              and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, tenantId))
            )
            .where(and(eq(crmDealContacts.tenantId, tenantId), eq(crmDeals.operatorId, operatorId)))
            .catch(() => []),
          db
            .select({
              dealId: crmConversationDeals.dealId,
              conversationId: crmConversationDeals.conversationId,
            })
            .from(crmConversationDeals)
            .innerJoin(
              crmDeals,
              and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId))
            )
            .where(
              and(
                eq(crmConversationDeals.tenantId, tenantId),
                eq(crmDeals.operatorId, operatorId),
                eq(crmConversationDeals.isActive, true)
              )
            )
            .catch(() => []),
          db
            .select()
            .from(crmCustomFieldDefinitions)
            .where(
              and(
                eq(crmCustomFieldDefinitions.tenantId, tenantId),
                isNull(crmCustomFieldDefinitions.archivedAt)
              )
            )
            .orderBy(asc(crmCustomFieldDefinitions.sortOrder), asc(crmCustomFieldDefinitions.createdAt))
            .catch(() => []),
        ]);

        allCustomFieldDefs = rawCfDefs.map((row) => ({
          ...row,
          options: parseJsonArray<{ id: string; label: string }>(row.options),
          pipelineIds: parseJsonArray<string>(row.pipelineIds),
        }));

        if (operatorDeals.length > 0) {
          interface EnrichedDealContact {
            contactId: string;
            name: string;
            phone: string | null;
            email: string | null;
            role: string;
            roleLabel: string;
            isPrimary: boolean;
            cnpj: string | null;
            cpf: string | null;
            tags: string[];
            customFieldsDecoded: DecodedCustomFieldsResult;
          }

          const dealContactMap = new Map<string, EnrichedDealContact>();
          const dealAllContactsMap = new Map<string, EnrichedDealContact[]>();
          const dealConvMap = new Map<string, string>();
          const contactConvMap = new Map<string, string>();

          for (const row of dcRows) {
            const decodedContactCf = decodeCustomFieldsForEntity(
              allCustomFieldDefs,
              "contact",
              row.contactCustomFields
            );
            const cObj: EnrichedDealContact = {
              contactId: row.contactId,
              name: row.contactName,
              phone: row.contactPhone || null,
              email: row.contactEmail || null,
              role: row.role || "buyer",
              roleLabel: formatContactRoleLabel(row.role),
              isPrimary: Boolean(row.isPrimary),
              cnpj: row.contactCnpj || null,
              cpf: row.contactCpf || null,
              tags: Array.isArray(row.contactTags) ? row.contactTags : [],
              customFieldsDecoded: decodedContactCf,
            };

            const list = dealAllContactsMap.get(row.dealId) || [];
            list.push(cObj);
            dealAllContactsMap.set(row.dealId, list);

            const existing = dealContactMap.get(row.dealId);
            if (!existing || row.isPrimary || (!existing.phone && row.contactPhone) || (!existing.email && row.contactEmail)) {
              dealContactMap.set(row.dealId, cObj);
            }
          }

          for (const cl of convLinks) {
            if (!dealConvMap.has(cl.dealId)) {
              dealConvMap.set(cl.dealId, cl.conversationId);
            }
          }

          // Busca conversas ativas do próprio operador para mapear contactId -> conversationId rapidamente
          try {
            const cConvs = await db
              .select({
                id: conversations.id,
                contactId: conversations.contactId,
              })
              .from(conversations)
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  eq(conversations.operatorId, operatorId)
                )
              )
              .orderBy(desc(conversations.lastMessageTime));
            for (const cc of cConvs) {
              if (!contactConvMap.has(cc.contactId)) {
                contactConvMap.set(cc.contactId, cc.id);
              }
            }
          } catch {}

          const normRecentAi = normalizeForMatch(recentAiContextText || "");
          const recentHistoryDealIdSet = new Set(
            (recentDealIdsFromHistory || []).map((id) => (id || "").trim()).filter(Boolean)
          );
          const nowMs = Date.now();
          const allEnrichedDeals = operatorDeals.map((d) => {
            const refDate = d.lastActivityAt || d.updatedAt || d.createdAt || new Date();
            const daysIdle = Math.max(0, Math.floor((nowMs - new Date(refDate).getTime()) / 86_400_000));
            const coolingThreshold =
              d.stageCoolingEnabled !== false && d.stageCoolingDays
                ? d.stageCoolingDays
                : d.pipelineCoolingDays || 3;
            const isActiveStatus = d.status === "open" || d.status === "paused";
            const isStalled = isActiveStatus && daysIdle >= Math.min(3, coolingThreshold);
            const isCoolingCritical = isActiveStatus && daysIdle >= coolingThreshold;

            const dc = dealContactMap.get(d.id);
            const allContacts = dealAllContactsMap.get(d.id) || (dc ? [dc] : []);
            const cfPhone = extractPhoneFromCustomFields(d.customFields);

            const contactName = dc?.name || d.accountName || null;
            const contactPhone = dc?.phone || d.accountPhone || cfPhone || null;
            const contactEmail = dc?.email || d.accountEmail || null;
            const contactRoleLabel = dc?.roleLabel || "COMPRADOR";
            const contactIsPrimary = dc ? dc.isPrimary : true;
            const contactId = dc?.contactId || null;
            const conversationId =
              dealConvMap.get(d.id) || (contactId ? contactConvMap.get(contactId) : undefined) || null;

            const dealCustomFieldsDecoded = decodeCustomFieldsForEntity(
              allCustomFieldDefs,
              "deal",
              d.customFields,
              d.pipelineId
            );
            const accountCustomFieldsDecoded = decodeCustomFieldsForEntity(
              allCustomFieldDefs,
              "company",
              d.accountCustomFields
            );

            const numValue = Number(d.value || 0);
            const valueFormatted = numValue > 0 ? formatBrl(numValue) : "R$ 0,00";
            const stageLabel = [d.pipelineName, d.stageName].filter(Boolean).join(" › ") || null;

            const codeMatch = (d.title || "").match(/\b(\d{4,})\b/)?.[1];
            const normAcc = normalizeForMatch(d.accountName || "");
            const normTitle = normalizeForMatch(d.title || "");
            const alreadyMentionedRecently = Boolean(
              recentHistoryDealIdSet.has(d.id) ||
                (normRecentAi &&
                  ((codeMatch && normRecentAi.includes(codeMatch)) ||
                    (normAcc.length >= 4 && normRecentAi.includes(normAcc)) ||
                    (normTitle.length >= 5 && normRecentAi.includes(normTitle))))
            );

            const dealItem: RelatedDealItem = {
              dealId: d.id,
              title: d.title,
              value: numValue,
              valueFormatted,
              stageName: d.stageName || null,
              pipelineName: d.pipelineName || null,
              stageLabel,
              accountName: d.accountName || null,
              company: d.accountName || null,
              contactName,
              contactPhone,
              conversationId,
              daysIdle,
              status: d.status,
            };
            knownDealMap.set(d.id, dealItem);

            const enrichedObj = {
              ...d,
              numValue,
              daysIdle,
              coolingThreshold,
              isStalled,
              isCoolingCritical,
              refDate,
              contactName,
              contactPhone,
              contactEmail,
              contactRoleLabel,
              contactIsPrimary,
              allContacts,
              dealCustomFieldsDecoded,
              accountCustomFieldsDecoded,
              customFieldsSummary: dealCustomFieldsDecoded.inlineSummary,
              conversationId,
              alreadyMentionedRecently,
            };
            enrichedDealByIdMap.set(d.id, enrichedObj);
            return enrichedObj;
          });

          // ── MENSURAÇÃO 100% COMPLETA DA CARTEIRA DO OPERADOR ──────────────────
          const openDeals = allEnrichedDeals.filter((d) => d.status === "open");
          const pausedDeals = allEnrichedDeals.filter((d) => d.status === "paused");
          const activeDeals = allEnrichedDeals.filter((d) => d.status === "open" || d.status === "paused");
          const wonDeals = allEnrichedDeals.filter((d) => d.status === "won");
          const lostDeals = allEnrichedDeals.filter((d) => d.status === "lost");

          const sumVal = (arr: typeof allEnrichedDeals) => arr.reduce((acc, x) => acc + x.numValue, 0);
          const totalPortfolioValue = sumVal(allEnrichedDeals);
          const totalOpenValue = sumVal(openDeals);
          const totalPausedValue = sumVal(pausedDeals);
          const totalActiveValue = sumVal(activeDeals);
          const totalWonValue = sumVal(wonDeals);
          const totalLostValue = sumVal(lostDeals);

          const pricedActiveDeals = activeDeals.filter((d) => d.numValue > 0);
          const zeroValueActiveDeals = activeDeals.filter((d) => d.numValue <= 0);
          const avgPricedTicket =
            pricedActiveDeals.length > 0 ? totalActiveValue / pricedActiveDeals.length : 0;

          // Faixas de inatividade (Aging) das negociações ativas
          const freshActive = activeDeals.filter((d) => d.daysIdle <= 2);
          const idle3to7 = activeDeals.filter((d) => d.daysIdle >= 3 && d.daysIdle <= 7);
          const idle8to30 = activeDeals.filter((d) => d.daysIdle >= 8 && d.daysIdle <= 30);
          const idleOver30 = activeDeals.filter((d) => d.daysIdle > 30);

          // Desdobramento completo por Funil (Pipeline) e Etapa (Stage)
          interface StageStats {
            stageName: string;
            openCount: number;
            pausedCount: number;
            activeCount: number;
            activeValue: number;
            pricedActiveCount: number;
            stalledCount: number;
            wonCount: number;
            wonValue: number;
            lostCount: number;
            lostValue: number;
          }
          interface PipelineStats {
            pipelineName: string;
            totalCount: number;
            openCount: number;
            pausedCount: number;
            activeCount: number;
            activeValue: number;
            stalledCount: number;
            wonCount: number;
            wonValue: number;
            lostCount: number;
            lostValue: number;
            stages: Map<string, StageStats>;
          }

          const pipelineStatsMap = new Map<string, PipelineStats>();
          for (const d of allEnrichedDeals) {
            const pName = d.pipelineName || "Funil Geral";
            const sName = d.stageName || "Sem Etapa";
            let pStat = pipelineStatsMap.get(pName);
            if (!pStat) {
              pStat = {
                pipelineName: pName,
                totalCount: 0,
                openCount: 0,
                pausedCount: 0,
                activeCount: 0,
                activeValue: 0,
                stalledCount: 0,
                wonCount: 0,
                wonValue: 0,
                lostCount: 0,
                lostValue: 0,
                stages: new Map<string, StageStats>(),
              };
              pipelineStatsMap.set(pName, pStat);
            }
            pStat.totalCount++;
            let sStat = pStat.stages.get(sName);
            if (!sStat) {
              sStat = {
                stageName: sName,
                openCount: 0,
                pausedCount: 0,
                activeCount: 0,
                activeValue: 0,
                pricedActiveCount: 0,
                stalledCount: 0,
                wonCount: 0,
                wonValue: 0,
                lostCount: 0,
                lostValue: 0,
              };
              pStat.stages.set(sName, sStat);
            }

            if (d.status === "open") {
              pStat.openCount++;
              pStat.activeCount++;
              pStat.activeValue += d.numValue;
              sStat.openCount++;
              sStat.activeCount++;
              sStat.activeValue += d.numValue;
              if (d.numValue > 0) sStat.pricedActiveCount++;
              if (d.isStalled) {
                pStat.stalledCount++;
                sStat.stalledCount++;
              }
            } else if (d.status === "paused") {
              pStat.pausedCount++;
              pStat.activeCount++;
              pStat.activeValue += d.numValue;
              sStat.pausedCount++;
              sStat.activeCount++;
              sStat.activeValue += d.numValue;
              if (d.numValue > 0) sStat.pricedActiveCount++;
              if (d.isStalled) {
                pStat.stalledCount++;
                sStat.stalledCount++;
              }
            } else if (d.status === "won") {
              pStat.wonCount++;
              pStat.wonValue += d.numValue;
              sStat.wonCount++;
              sStat.wonValue += d.numValue;
            } else if (d.status === "lost") {
              pStat.lostCount++;
              pStat.lostValue += d.numValue;
              sStat.lostCount++;
              sStat.lostValue += d.numValue;
            }
          }

          const sortedPipelines = Array.from(pipelineStatsMap.values()).sort(
            (a, b) => b.activeCount - a.activeCount || b.activeValue - a.activeValue || b.totalCount - a.totalCount
          );

          const funnelBreakdownLines = sortedPipelines
            .map((p) => {
              const stageLines = Array.from(p.stages.values())
                .sort((a, b) => b.activeCount - a.activeCount || b.activeValue - a.activeValue || b.lostCount - a.lostCount)
                .map((s) => {
                  const parts: string[] = [];
                  if (s.activeCount > 0) {
                    parts.push(
                      `${s.activeCount} ativa(s)${s.pausedCount > 0 ? ` (${s.openCount} abertas + ${s.pausedCount} pausadas)` : ""} somando ${formatBrl(s.activeValue)} [${s.pricedActiveCount} c/ valor > R$ 0 | ${s.stalledCount} paradas >=3d]`
                    );
                  }
                  if (s.wonCount > 0) parts.push(`${s.wonCount} ganha(s) (${formatBrl(s.wonValue)})`);
                  if (s.lostCount > 0) parts.push(`${s.lostCount} perdida(s) (${formatBrl(s.lostValue)})`);
                  return `      - Etapa "${s.stageName}": ${parts.join(" | ")}`;
                })
                .join("\n");

              return (
                `  • FUNIL "${p.pipelineName}": ${p.activeCount} ativas (${p.openCount} abertas + ${p.pausedCount} pausadas = ${formatBrl(p.activeValue)}) | Paradas >=3d: ${p.stalledCount} | Ganhas: ${p.wonCount} (${formatBrl(p.wonValue)}) | Perdidas: ${p.lostCount} (${formatBrl(p.lostValue)}) | Total histórico no funil: ${p.totalCount}\n` +
                stageLines
              );
            })
            .join("\n");

          sections.push(
            `📊 RAIO-X E MENSURAÇÃO 100% COMPLETA DA SUA CARTEIRA NO CRM (TODAS AS ${allEnrichedDeals.length} NEGOCIAÇÕES EM SEU NOME — SEM LIMITE DE 60):\n` +
              `  • Total Geral de Negociações em seu nome: ${allEnrichedDeals.length} negociações somando ${formatBrl(totalPortfolioValue)}\n` +
              `  • Negociações EM ABERTO (status open): ${openDeals.length} negociações somando ${formatBrl(totalOpenValue)}\n` +
              `  • Negociações PAUSADAS (status paused): ${pausedDeals.length} negociações somando ${formatBrl(totalPausedValue)}\n` +
              `  • TOTAL ATIVAS NO PIPELINE (abertas + pausadas): ${activeDeals.length} negociações somando ${formatBrl(totalActiveValue)}\n` +
              `    - Com valor de proposta preenchido (> R$ 0): ${pricedActiveDeals.length} negociações (Ticket Médio: ${formatBrl(avgPricedTicket)})\n` +
              `    - Sem valor preenchido (R$ 0,00 / em qualificação ou suporte): ${zeroValueActiveDeals.length} negociações\n` +
              `  • Negociações GANHAS (status won): ${wonDeals.length} negociações somando ${formatBrl(totalWonValue)}\n` +
              `  • Negociações PERDIDAS (status lost): ${lostDeals.length} negociações somando ${formatBrl(totalLostValue)}\n` +
              `  • SAÚDE E TEMPO DE INATIVIDADE DAS ${activeDeals.length} NEGOCIAÇÕES ATIVAS:\n` +
              `    - Em dia (0 a 2 dias sem interação): ${freshActive.length} negociações (${formatBrl(sumVal(freshActive))})\n` +
              `    - Atenção (3 a 7 dias sem interação): ${idle3to7.length} negociações (${formatBrl(sumVal(idle3to7))})\n` +
              `    - Esfriando (8 a 30 dias sem interação): ${idle8to30.length} negociações (${formatBrl(sumVal(idle8to30))})\n` +
              `    - Críticas / Congeladas (+30 dias sem interação): ${idleOver30.length} negociações (${formatBrl(sumVal(idleOver30))})\n\n` +
              `📂 MENSURAÇÃO COMPLETA POR FUNIL E POR ETAPA (${sortedPipelines.length} funis na sua carteira):\n${funnelBreakdownLines}`
          );

          const formatDealLine = (d: (typeof allEnrichedDeals)[number]) => {
            const accTypeLabel =
              d.accountType === "company"
                ? "PJ"
                : d.accountType === "person"
                ? "PF"
                : "";
            const acc =
              d.accountName && d.accountName !== d.title
                ? ` (${d.accountName}${accTypeLabel ? ` - ${accTypeLabel}` : ""}${d.accountDocument ? ` | Doc: ${d.accountDocument}` : ""})`
                : "";
            const contactPart = d.contactName
              ? ` | Contato: ${d.contactName} [${d.contactRoleLabel}${d.contactIsPrimary ? " Principal" : ""}]`
              : "";
            const phonePart = d.contactPhone ? ` | 📞 Tel: ${d.contactPhone}` : "";
            const emailPart = d.contactEmail ? ` | ✉️ E-mail: ${d.contactEmail}` : "";
            const closePart = d.expectedCloseDate
              ? ` | Prev. Fechamento: ${formatDateOnlyBrt(d.expectedCloseDate)}`
              : "";
            const datesPart = ` | Criado em: ${formatDateTimeBrt(d.createdAt)} | Atualizado em: ${formatDateTimeBrt(d.updatedAt)}`;
            const ratingPart = d.rating && d.rating > 0 ? ` | Qualificação: ${d.rating}/5` : "";
            const cfPart = d.customFieldsSummary
              ? ` | Campos Personalizados Preenchidos: [${d.customFieldsSummary}]`
              : " | Campos Personalizados Preenchidos: [Nenhum]";
            const convPart = d.conversationId ? ` | convId: ${d.conversationId}` : "";
            const statusBadge =
              d.status === "paused"
                ? " [PAUSADA]"
                : d.status === "lost"
                ? " [PERDIDA]"
                : d.status === "won"
                ? " [GANHA]"
                : "";
            return `  • "${d.title}"${acc}${statusBadge} — ${formatBrl(d.numValue)} | Funil/Etapa: ${d.pipelineName || "Funil"} > ${d.stageName || "N/A"} | Parada há: ${d.daysIdle}d${contactPart}${phonePart}${emailPart}${closePart}${datesPart}${ratingPart}${cfPart} (dealId: ${d.id}${convPart})`;
          };

          // Prioriza negociações paradas que AINDA NÃO foram citadas nas últimas mensagens da conversa
          const stalledDeals = activeDeals
            .filter((d) => d.isStalled)
            .sort((a, b) => {
              if (a.alreadyMentionedRecently !== b.alreadyMentionedRecently) {
                return a.alreadyMentionedRecently ? 1 : -1;
              }
              return b.numValue - a.numValue || b.daysIdle - a.daysIdle;
            });

          // 1) Ranking das Top 30 Negociações Ativas de Maior Valor (> R$ 0)
          const topByValueDeals = [...pricedActiveDeals]
            .sort((a, b) => b.numValue - a.numValue)
            .slice(0, 30);
          if (topByValueDeals.length > 0) {
            sections.push(
              `💰 TOP ${topByValueDeals.length} NEGOCIAÇÕES ATIVAS DE MAIOR VALOR NA SUA CARTEIRA (de ${pricedActiveDeals.length} precificadas):\n` +
                topByValueDeals.map(formatDealLine).join("\n")
            );
          }

          // 2) Negociações em Etapas Quentes (Fechamento, Proposta Enviada, Escopo, Qualificado, Abordagem)
          const hotStageDeals = activeDeals
            .filter((d) =>
              /fechamento|proposta|escopo|qualificad|abordagem|prospec/i.test(
                `${d.stageName || ""} ${d.pipelineName || ""}`
              )
            )
            .sort((a, b) => b.numValue - a.numValue || a.daysIdle - b.daysIdle)
            .slice(0, 30);
          if (hotStageDeals.length > 0) {
            sections.push(
              `🔥 NEGOCIAÇÕES EM ETAPAS QUENTES (FECHAMENTO / PROPOSTA ENVIADA / ESCOPO / QUALIFICADO — Top ${hotStageDeals.length}):\n` +
                hotStageDeals.map(formatDealLine).join("\n")
            );
          }

          // 3) Se o operador filtrou por funil, etapa, status ou palavra-chave específica na pergunta
          const asksLost = /\b(?:perdida|perdidas|perdido|perdidos)\b/.test(q);
          const asksWon = /\b(?:ganha|ganhas|ganho|ganhos|fechada|fechadas)\b/.test(q);
          const asksPaused = /\b(?:pausada|pausadas|pausado|pausados)\b/.test(q);

          const poolForQueryFilter = asksLost
            ? lostDeals
            : asksWon
            ? wonDeals
            : asksPaused
            ? pausedDeals
            : activeDeals;

          const matchedByQueryPool = poolForQueryFilter.filter((d) => {
            const hay = normalizeForMatch(
              `${d.title || ""} ${d.accountName || ""} ${d.accountTradeName || ""} ${d.accountDocument || ""} ${d.contactName || ""} ${d.contactEmail || ""} ${d.contactPhone || ""} ${d.pipelineName || ""} ${d.stageName || ""} ${d.customFieldsSummary || ""}`
            );
            if (primaryTerms.length > 0 && primaryTerms.some((t) => hay.includes(t))) return true;
            for (const p of sortedPipelines) {
              const pNorm = normalizeForMatch(p.pipelineName).replace(/^funil\s+/, "");
              if (pNorm.length >= 3 && q.includes(pNorm) && d.pipelineName === p.pipelineName) {
                return true;
              }
            }
            return false;
          });

          if (matchedByQueryPool.length > 0) {
            const sortedMatched = [...matchedByQueryPool]
              .sort((a, b) => b.numValue - a.numValue || a.daysIdle - b.daysIdle)
              .slice(0, 50);
            sections.push(
              `🎯 NEGOCIAÇÕES DA SUA CARTEIRA QUE CORRESPONDEM ESPECIFICAMENTE AO FILTRO DA PERGUNTA (${matchedByQueryPool.length} encontradas — exibindo até 50):\n` +
                sortedMatched.map(formatDealLine).join("\n")
            );
          }

          // 4) As 30 Negociações Ativas Mais Recentes / Movimentadas Recentemente
          const recentActiveLines = activeDeals.slice(0, 30).map(formatDealLine).join("\n");
          sections.push(
            `💼 NEGOCIAÇÕES ATIVAS MAIS RECENTES DA SUA CARTEIRA (exibindo as 30 mais recentes de ${activeDeals.length} ativas e ${allEnrichedDeals.length} totais):\n${recentActiveLines}`
          );

          const asksAboutStalledOrDeals =
            isOverviewOrGeneral || isDealOrCrm || isCallOrPhone || isFollowUpRequest;

          if (asksAboutStalledOrDeals && stalledDeals.length > 0) {
            const stalledLines = stalledDeals
              .slice(0, 20)
              .map((d) => {
                const badge = d.isCoolingCritical
                  ? "❄️ ESFRIANDO / PARADA CRÍTICA"
                  : "⚠️ SEM INTERAÇÃO RECENTE";
                const recentTag = d.alreadyMentionedRecently
                  ? " [JÁ CITADA NAS ÚLTIMAS MENSAGENS — NÃO REPITA SE O VENDEDOR PEDIR OUTRAS]"
                  : " [NOVA OPÇÃO — AINDA NÃO CITADA]";
                const acc = d.accountName ? ` | Cliente/Conta: ${d.accountName}` : "";
                const contactPart = d.contactName ? ` | Contato: ${d.contactName} (${d.contactRoleLabel})` : "";
                const phonePart = d.contactPhone ? ` | 📞 Tel: ${d.contactPhone}` : "";
                const emailPart = d.contactEmail ? ` | ✉️ E-mail: ${d.contactEmail}` : "";
                const cfPart = d.customFieldsSummary ? ` | Campos Personalizados: [${d.customFieldsSummary}]` : "";
                const convPart = d.conversationId ? ` | convId: ${d.conversationId}` : "";
                return `  • [${badge} — ${d.daysIdle} dia(s) sem movimentação]${recentTag} "${d.title}"${acc} | Valor: ${formatBrl(d.numValue)} | Funil/Etapa: ${d.pipelineName || "Geral"} > ${d.stageName || "N/A"}${contactPart}${phonePart}${emailPart}${cfPart} (dealId: ${d.id}${convPart})`;
              })
              .join("\n");
            sections.push(
              `❄️ AMOSTRA DE NEGOCIAÇÕES PARADAS / ESFRIANDO COM MAIOR PRIORIDADE (${stalledDeals.length} paradas de ${activeDeals.length} ativas):\n${stalledLines}`
            );
          }

          const dealsMs = Math.max(15, Date.now() - tDeals0);
          pushRealStep({
            id: "step-op-deals",
            kind: "analyze",
            actionVerb: "Analisou",
            targetLabel: "crm_deals, crm_accounts & crm_custom_field_definitions",
            scopeTag: `#${activeDeals.length}-ativas • #${allEnrichedDeals.length}-total • ${dealsMs}ms`,
            badgeType: "crm",
            detailText: `${allEnrichedDeals.length} negociações totais na sua carteira (${openDeals.length} abertas [${formatBrl(totalOpenValue)}], ${pausedDeals.length} pausadas [${formatBrl(totalPausedValue)}], ${wonDeals.length} ganhas, ${lostDeals.length} perdidas e ${allCustomFieldDefs.length} definições de campos personalizados) mensuradas no banco em ${dealsMs}ms.`,
          });
        } else {
          sections.push(`💼 SUAS NEGOCIAÇÕES NO CRM: Você não possui negociações vinculadas ao seu usuário no momento.`);
          const dealsMs = Math.max(10, Date.now() - tDeals0);
          pushRealStep({
            id: "step-op-deals",
            kind: "analyze",
            actionVerb: "Analisou",
            targetLabel: "crm_deals",
            scopeTag: `#0-negociacoes • ${dealsMs}ms`,
            badgeType: "crm",
            detailText: `Consulta concluída em ${dealsMs}ms — 0 negociações encontradas.`,
          });
        }
      } catch (dealErr: any) {
        console.warn("[getOperatorContext] Aviso ao carregar negociações do operador:", dealErr?.message);
      }
    }

    // ── 3. TAREFAS, LIGAÇÕES AGENDADAS E REUNIÕES DO OPERADOR ────────────────
    if (shouldRunTasks) {
      const tTasks0 = Date.now();
      try {
        const crmActivities = await db
          .select({
            id: crmDealActivities.id,
            type: crmDealActivities.type,
            title: crmDealActivities.title,
            description: crmDealActivities.description,
            status: crmDealActivities.status,
            dueDate: crmDealActivities.dueDate,
            dealId: crmDealActivities.dealId,
            dealTitle: crmDeals.title,
            dealValue: crmDeals.value,
          })
          .from(crmDealActivities)
          .leftJoin(crmDeals, and(eq(crmDeals.id, crmDealActivities.dealId), eq(crmDeals.tenantId, tenantId)))
          .where(
            and(
              eq(crmDealActivities.tenantId, tenantId),
              or(
                eq(crmDealActivities.assignedToOperatorId, operatorId),
                and(isNull(crmDealActivities.assignedToOperatorId), eq(crmDealActivities.operatorId, operatorId))
              ),
              eq(crmDealActivities.status, "pending")
            )
          )
          .orderBy(asc(crmDealActivities.dueDate))
          .limit(40);

        const generalTasks = operatorEmail
          ? await db
              .select()
              .from(tasks)
              .where(
                and(
                  eq(tasks.tenantId, tenantId),
                  eq(tasks.operatorEmail, operatorEmail),
                  ne(tasks.status, "done")
                )
              )
              .orderBy(asc(tasks.dueDate))
              .limit(25)
          : [];

        const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

        const formatActivityItem = (a: (typeof crmActivities)[number]) => {
          const dueStr = a.dueDate
            ? new Date(a.dueDate).toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "Sem data";
          const dueDay = a.dueDate
            ? new Date(a.dueDate).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
            : "";
          const tag =
            dueDay && dueDay < todayStr
              ? "🚨 ATRASADA"
              : dueDay === todayStr
              ? "🔥 HOJE"
              : "📅 AGENDADA";
          const linkedDeal = a.dealId ? knownDealMap.get(a.dealId) : undefined;
          const phoneStr = linkedDeal?.contactPhone ? ` | 📞 Tel: ${linkedDeal.contactPhone}` : "";
          const dealPart = a.dealTitle
            ? ` | Negociação: "${a.dealTitle}" (${formatBrl(Number(a.dealValue || 0))}${a.dealId ? `, dealId: ${a.dealId}` : ""})${phoneStr}`
            : "";
          const descPart = a.description ? ` — Obs: ${a.description.slice(0, 100)}` : "";
          return `  • [${tag} - ${dueStr}] ${a.title}${dealPart}${descPart}`;
        };

        const scheduledCalls = crmActivities.filter(
          (a) => a.type === "call" || /liga[cç][aã]o|ligar|call|telefonema/i.test(a.title)
        );
        const otherActivities = crmActivities.filter((a) => !scheduledCalls.includes(a));

        for (const sc of scheduledCalls) {
          const linkedDeal = sc.dealId ? knownDealMap.get(sc.dealId) : undefined;
          if (linkedDeal?.contactPhone) {
            scheduledCallActions.push({
              id: `sched-call-${sc.id}`,
              clientName: linkedDeal.contactName || linkedDeal.accountName || sc.title,
              phone: linkedDeal.contactPhone,
              company: linkedDeal.accountName || null,
              dealId: linkedDeal.dealId,
              dealTitle: linkedDeal.title,
              dealValue: linkedDeal.value ?? null,
              dealValueFormatted: linkedDeal.valueFormatted ?? null,
              stageLabel: linkedDeal.stageLabel ?? null,
              conversationId: linkedDeal.conversationId || null,
              reason: sc.title,
            });
          }
        }

        const legacyCalls = generalTasks.filter(
          (t) => t.type === "call" || /liga[cç][aã]o|ligar|call|telefonema/i.test(t.name)
        );
        const legacyOtherTasks = generalTasks.filter((t) => !legacyCalls.includes(t));

        const callLines = [
          ...scheduledCalls.map(formatActivityItem),
          ...legacyCalls.map(
            (t) =>
              `  • [${t.dueDate || "Sem data"}] 📞 ${t.name}${t.clientName ? ` | Cliente: ${t.clientName}` : ""}${t.dealName ? ` | Deal: ${t.dealName}` : ""}${t.description ? ` — ${t.description.slice(0, 90)}` : ""}`
          ),
        ];

        if (callLines.length > 0) {
          sections.push(`📞 SUAS LIGAÇÕES AGENDADAS (${callLines.length}):\n${callLines.join("\n")}`);
        } else {
          sections.push(`📞 SUAS LIGAÇÕES AGENDADAS: Nenhuma ligação pendente agendada no momento.`);
        }

        const taskLines = [
          ...otherActivities.map((a) => {
            const typeLabel = a.type === "meeting" ? "🤝 Reunião" : "📋 Tarefa";
            return `${formatActivityItem(a)} (${typeLabel})`;
          }),
          ...legacyOtherTasks.map(
            (t) =>
              `  • [${t.dueDate || "Sem data"} | Status: ${t.status}] 📋 ${t.name}${t.clientName ? ` | Cliente: ${t.clientName}` : ""}${t.dealName ? ` | Deal: ${t.dealName}` : ""}${t.description ? ` — ${t.description.slice(0, 90)}` : ""}`
          ),
        ];

        if (taskLines.length > 0) {
          sections.push(`✅ SUAS TAREFAS, FOLLOW-UPS E REUNIÕES PENDENTES (${taskLines.length}):\n${taskLines.join("\n")}`);
        } else {
          sections.push(`✅ SUAS TAREFAS E REUNIÕES PENDENTES: Nenhuma tarefa pendente cadastrada no momento.`);
        }

        const tasksMs = Math.max(10, Date.now() - tTasks0);
        pushRealStep({
          id: "step-op-tasks",
          kind: "search",
          actionVerb: "Verificou",
          targetLabel: "tasks & crm_deal_activities",
          scopeTag: `#${callLines.length}-ligacoes • ${taskLines.length}-tarefas • ${tasksMs}ms`,
          badgeType: "sla",
          detailText: `${callLines.length} ligações agendadas e ${taskLines.length} tarefas/reuniões pendentes consultadas em ${tasksMs}ms.`,
        });
      } catch (taskErr: any) {
        console.warn("[getOperatorContext] Aviso ao carregar tarefas/ligações:", taskErr?.message);
      }
    }

    // ── 4. CONVERSAS ATIVAS, CLIENTES AGUARDANDO RESPOSTA (SLA) E LEADS DE HOJE ──
    let activeConvs: Array<{
      id: string;
      contactId: string;
      contactName: string;
      contactPhone: string | null;
      contactCompany: string | null;
      lastMessage: string | null;
      lastTime: Date;
      lastClientMsg: Date | null;
      lastOpMsg: Date | null;
      createdAt: Date;
      queueState: string;
      unread: number;
      dealTitle?: string | null;
      funnelName?: string | null;
    }> = [];

    if (shouldRunChats) {
      const tConvs0 = Date.now();
      try {
        const rawConvs = await db
          .select({
            id: conversations.id,
            contactId: conversations.contactId,
            contactName: contacts.name,
            contactPhone: contacts.phone,
            contactCompany: crmAccounts.name,
            lastMessage: conversations.lastMessageText,
            lastTime: conversations.lastMessageTime,
            lastClientMsg: conversations.lastClientMessageAt,
            lastOpMsg: conversations.lastOperatorMessageAt,
            createdAt: conversations.createdAt,
            queueState: conversations.queueState,
            unread: conversations.unreadCount,
          })
          .from(conversations)
          .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)))
          .leftJoin(crmAccounts, and(eq(crmAccounts.id, contacts.accountId), eq(crmAccounts.tenantId, tenantId)))
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              eq(conversations.operatorId, operatorId),
              ne(conversations.queueState, "finalizados")
            )
          )
          .orderBy(desc(conversations.lastMessageTime))
          .limit(25);

        const convIds = rawConvs.map((c) => c.id);
        const convDealMap = new Map<string, { dealTitle: string; funnelName: string | null }>();
        if (convIds.length > 0) {
          const linkedDeals = await db
            .select({
              conversationId: crmConversationDeals.conversationId,
              dealTitle: crmDeals.title,
              funnelName: crmPipelines.name,
            })
            .from(crmConversationDeals)
            .innerJoin(crmDeals, and(eq(crmDeals.id, crmConversationDeals.dealId), eq(crmDeals.tenantId, tenantId)))
            .leftJoin(crmPipelines, and(eq(crmPipelines.id, crmDeals.pipelineId), eq(crmPipelines.tenantId, tenantId)))
            .where(
              and(
                eq(crmConversationDeals.tenantId, tenantId),
                inArray(crmConversationDeals.conversationId, convIds),
                eq(crmConversationDeals.isActive, true)
              )
            );
          for (const ld of linkedDeals) {
            if (!convDealMap.has(ld.conversationId)) {
              convDealMap.set(ld.conversationId, {
                dealTitle: ld.dealTitle,
                funnelName: ld.funnelName || null,
              });
            }
          }
        }

        activeConvs = rawConvs.map((c) => ({
          ...c,
          dealTitle: convDealMap.get(c.id)?.dealTitle || null,
          funnelName: convDealMap.get(c.id)?.funnelName || null,
        }));

        const brtNowStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
        const startOfToday = new Date(`${brtNowStr}T00:00:00-03:00`);

        const todayTransfers = await db
          .select({
            content: internalMessages.content,
            metadata: internalMessages.metadata,
            createdAt: internalMessages.createdAt,
          })
          .from(internalMessages)
          .where(
            and(
              eq(internalMessages.tenantId, tenantId),
              eq(internalMessages.operatorId, operatorId),
              sql`${internalMessages.metadata}->>'type' = 'lead_transfer'`,
              gte(internalMessages.createdAt, startOfToday)
            )
          )
          .orderBy(desc(internalMessages.createdAt))
          .limit(20);

        const todayTransferLines: string[] = [];
        const seenTodayConvIds = new Set<string>();

        for (const tr of todayTransfers) {
          const meta = (tr.metadata || {}) as any;
          const cId = meta.conversationId || meta.clientId || "";
          const cName = meta.clientName || meta.contactName || "Cliente";
          if (cId && seenTodayConvIds.has(cId)) continue;
          if (cId) seenTodayConvIds.add(cId);

          const hora = tr.createdAt
            ? new Date(tr.createdAt).toLocaleTimeString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";
          todayTransferLines.push(
            `  • [Transferido hoje às ${hora}] ${cName}${meta.company ? ` (${meta.company})` : ""}${meta.targetFunnel ? ` | Funil: ${meta.targetFunnel}` : ""}${meta.dealTitle ? ` | Card: "${meta.dealTitle}"` : ""} (convId: ${cId})`
          );
          if (cId) {
            const item: RelatedConversationItem = {
              clientId: cId,
              clientName: cName,
              clientPhone: meta.clientPhone || meta.phone || null,
              company: meta.company || null,
              lastMessage: meta.interest || null,
              dealTitle: meta.dealTitle || null,
              funnelName: meta.targetFunnel || null,
              temperature: meta.temperature || null,
            };
            todayLeadsConversations.push(item);
            knownConvMap.set(cId, item);
          }
        }

        if (activeConvs.length > 0) {
          const waitingClients: string[] = [];
          const convLines: string[] = [];

          for (const c of activeConvs) {
            const agoMin = Math.max(0, Math.floor((Date.now() - new Date(c.lastTime).getTime()) / 60_000));
            const companyInfo = c.contactCompany ? ` [${c.contactCompany}]` : "";
            const dealInfo = c.dealTitle ? ` | Card: "${c.dealTitle}"${c.funnelName ? ` (${c.funnelName})` : ""}` : "";
            const phoneInfo = c.contactPhone ? ` | 📞 Tel: ${c.contactPhone}` : "";

            // Usa lastClientMessageAt e lastOperatorMessageAt direto da tabela conversations (zero N+1 queries!)
            const clientMsgMs = c.lastClientMsg ? new Date(c.lastClientMsg).getTime() : 0;
            const opMsgMs = c.lastOpMsg ? new Date(c.lastOpMsg).getTime() : 0;
            const isClientWaiting =
              c.queueState === "meus" && clientMsgMs > 0 && (opMsgMs === 0 || clientMsgMs > opMsgMs);
            const waitMinutes = isClientWaiting
              ? Math.max(1, Math.floor((Date.now() - clientMsgMs) / 60_000))
              : agoMin;
            const cleanPreview = (c.lastMessage || "")
              .replace(/^\[(LOCAL_MEDIA|MEDIA):[^\]]+\]\s*/i, "[Mídia] ")
              .trim()
              .slice(0, 110);

            const convItem: RelatedConversationItem = {
              clientId: c.id,
              clientName: c.contactName,
              clientPhone: c.contactPhone || null,
              company: c.contactCompany || null,
              lastMessage: cleanPreview || null,
              waitMinutes: isClientWaiting ? waitMinutes : null,
              isWaiting: isClientWaiting,
              dealTitle: c.dealTitle || null,
              funnelName: c.funnelName || null,
            };
            knownConvMap.set(c.id, convItem);

            if (c.createdAt && new Date(c.createdAt) >= startOfToday && !seenTodayConvIds.has(c.id)) {
              seenTodayConvIds.add(c.id);
              todayLeadsConversations.push(convItem);
              const hora = new Date(c.createdAt).toLocaleTimeString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                hour: "2-digit",
                minute: "2-digit",
              });
              todayTransferLines.push(
                `  • [Iniciado hoje às ${hora}] ${c.contactName}${companyInfo}${dealInfo}${phoneInfo} (convId: ${c.id}): "${cleanPreview}"`
              );
            }

            if (isClientWaiting) {
              waitingConversations.push(convItem);
              const slaTag =
                waitMinutes >= 15
                  ? "🚨 SLA ESTOURADO (>15min)"
                  : waitMinutes >= 8
                  ? "⚠️ ATENÇÃO SLA (8-14min)"
                  : "⏳ Aguardando resposta";
              waitingClients.push(
                `  • ${c.contactName}${companyInfo}${phoneInfo} (convId: ${c.id}) — esperando há ${waitMinutes}min (${slaTag})${dealInfo}: "${cleanPreview}"`
              );
            }

            convLines.push(
              `  • ${c.contactName}${companyInfo}${phoneInfo} (convId: ${c.id} | Fila: ${c.queueState}${isClientWaiting ? ` | ⏳ Cliente aguarda há ${waitMinutes}min` : " | ✅ Respondido"}) — última msg há ${agoMin}min${c.unread > 0 ? ` [${c.unread} não lida(s)]` : ""}${dealInfo}: "${cleanPreview}"`
            );
          }

          if (todayTransferLines.length > 0) {
            sections.push(
              `📥 LEADS E NOVOS ATENDIMENTOS QUE CHEGARAM PARA VOCÊ HOJE (${todayTransferLines.length}):\n${todayTransferLines.join("\n")}`
            );
          } else {
            sections.push(
              `📥 LEADS E NOVOS ATENDIMENTOS QUE CHEGARAM PARA VOCÊ HOJE: 0 leads novos transferidos hoje até o momento (você possui ${activeConvs.length} conversa(s) ativa(s) em andamento na fila).`
            );
          }

          if (waitingClients.length > 0) {
            sections.push(
              `⏱️ CLIENTES AGUARDANDO SUA RESPOSTA AGORA (${waitingClients.length}):\n${waitingClients.join("\n")}`
            );
          } else {
            sections.push(`⏱️ CLIENTES AGUARDANDO RESPOSTA (SLA): Nenhum cliente esperando resposta na sua fila agora!`);
          }

          sections.push(`💬 SUAS CONVERSAS ATIVAS (${activeConvs.length}):\n${convLines.join("\n")}`);
        } else {
          if (todayTransferLines.length > 0) {
            sections.push(
              `📥 LEADS E NOVOS ATENDIMENTOS QUE CHEGARAM PARA VOCÊ HOJE (${todayTransferLines.length}):\n${todayTransferLines.join("\n")}`
            );
          } else {
            sections.push(`📥 LEADS QUE CHEGARAM HOJE: Nenhum lead novo recebido hoje até o momento.`);
          }
          sections.push("💬 Você não tem conversas ativas em andamento no momento.");
        }

        const convsMs = Math.max(10, Date.now() - tConvs0);
        pushRealStep({
          id: "step-op-convs",
          kind: "search",
          actionVerb: "Verificou",
          targetLabel: "conversations",
          scopeTag: `#${activeConvs.length}-ativas • ${waitingConversations.length}-aguardando • ${convsMs}ms`,
          badgeType: "chat",
          detailText: `${activeConvs.length} conversas ativas na fila (${waitingConversations.length} aguardando resposta e ${todayLeadsConversations.length} leads hoje) verificadas em ${convsMs}ms.`,
        });
      } catch (convErr: any) {
        console.warn("[getOperatorContext] Aviso ao carregar conversas ativas:", convErr?.message);
      }
    }

    // ── 5. BUSCA PROFUNDA SOB DEMANDA (FICHA 360º DE NEGOCIAÇÕES DO CRM + CONVERSAS) + GUARDA DE SIGILO ──
    const fallbackAiTerms =
      isFollowUpRequest || primaryTerms.length === 0
        ? extractSearchCandidateTerms(recentAiContextText)
        : [];
    const searchTerms = Array.from(new Set([...primaryTerms, ...fallbackAiTerms])).slice(0, 8);
    const hasRecentHistoryDeals = Array.isArray(recentDealIdsFromHistory) && recentDealIdsFromHistory.length > 0;

    if (!isPureKbQuery && (searchTerms.length > 0 || knownDealMap.size > 0 || hasRecentHistoryDeals)) {
      const tDeep0 = Date.now();
      try {
        const normCombinedContext = normalizeForMatch(
          `${userQuery || ""} ${isFollowUpRequest || primaryTerms.length === 0 ? recentAiContextText || "" : ""}`
        );

        const matchedDealsMap = new Map<string, RelatedDealItem>();

        // 5.1 Match por código numérico (ex: 0020947 ou 20947), razão social, título, contato, e-mail ou campos personalizados
        for (const d of knownDealMap.values()) {
          const enriched = enrichedDealByIdMap.get(d.dealId);
          const hay = normalizeForMatch(
            `${d.title || ""} ${d.accountName || ""} ${enriched?.accountTradeName || ""} ${enriched?.accountDocument || ""} ${d.contactName || ""} ${enriched?.contactEmail || ""} ${d.contactPhone || ""} ${enriched?.customFieldsSummary || ""}`
          );
          if (!hay) continue;

          const codeRaw = (d.title || "").match(/\b(\d{4,})\b/)?.[1];
          const codeStripped = codeRaw ? codeRaw.replace(/^0+/, "") : "";
          if (
            (codeRaw && normCombinedContext.includes(codeRaw)) ||
            (codeStripped && codeStripped.length >= 4 && normCombinedContext.includes(codeStripped))
          ) {
            matchedDealsMap.set(d.dealId, d);
            continue;
          }

          if (d.accountName && d.accountName.length >= 4 && normCombinedContext.includes(normalizeForMatch(d.accountName))) {
            matchedDealsMap.set(d.dealId, d);
            continue;
          }

          if (searchTerms.some((t) => t.length >= 3 && hay.includes(t))) {
            matchedDealsMap.set(d.dealId, d);
          }
        }

        // 5.2 Se for uma pergunta de follow-up ("que informações a mais vc possui dela?", "ela tem campo customizado?", "qual o e-mail dele?")
        // ou se referir às negociações recém-citadas no histórico da conversa, inclui automaticamente os cards em foco!
        if (
          (isFollowUpRequest || matchedDealsMap.size === 0) &&
          (isFollowUpRequest || isDealOrCrm || isCallOrPhone || primaryTerms.length === 0)
        ) {
          if (Array.isArray(recentDealIdsFromHistory)) {
            for (const histDealId of recentDealIdsFromHistory) {
              const found = knownDealMap.get((histDealId || "").trim());
              if (found) matchedDealsMap.set(found.dealId, found);
            }
          }
          if (matchedDealsMap.size === 0) {
            for (const [dealId, enriched] of enrichedDealByIdMap.entries()) {
              if (enriched?.alreadyMentionedRecently) {
                const found = knownDealMap.get(dealId);
                if (found) matchedDealsMap.set(dealId, found);
              }
            }
          }
        }

        const matchedDeals = Array.from(matchedDealsMap.values());

        if (matchedDeals.length > 0) {
          const dealDeepLines: string[] = [];
          for (const md of matchedDeals.slice(0, 4)) {
            const enriched = enrichedDealByIdMap.get(md.dealId);

            // Busca em paralelo TODAS as abas e tabelas filhas da negociação no CRM
            const [acts, dealProducts, dealProposals, dealEvents, dealFiles, dealQuestionnaires, dealEmails] =
              await Promise.all([
                db
                  .select({
                    id: crmDealActivities.id,
                    type: crmDealActivities.type,
                    title: crmDealActivities.title,
                    description: crmDealActivities.description,
                    status: crmDealActivities.status,
                    dueDate: crmDealActivities.dueDate,
                    completedAt: crmDealActivities.completedAt,
                    createdAt: crmDealActivities.createdAt,
                  })
                  .from(crmDealActivities)
                  .where(and(eq(crmDealActivities.tenantId, tenantId), eq(crmDealActivities.dealId, md.dealId)))
                  .orderBy(desc(crmDealActivities.createdAt))
                  .limit(15)
                  .catch(() => []),
                db
                  .select()
                  .from(crmDealProducts)
                  .where(and(eq(crmDealProducts.tenantId, tenantId), eq(crmDealProducts.dealId, md.dealId)))
                  .orderBy(asc(crmDealProducts.createdAt))
                  .catch(() => []),
                db
                  .select()
                  .from(crmProposals)
                  .where(and(eq(crmProposals.tenantId, tenantId), eq(crmProposals.dealId, md.dealId)))
                  .orderBy(desc(crmProposals.createdAt))
                  .catch(() => []),
                db
                  .select()
                  .from(crmDealEvents)
                  .where(and(eq(crmDealEvents.tenantId, tenantId), eq(crmDealEvents.dealId, md.dealId)))
                  .orderBy(desc(crmDealEvents.createdAt))
                  .limit(10)
                  .catch(() => []),
                db
                  .select()
                  .from(crmDealFiles)
                  .where(and(eq(crmDealFiles.tenantId, tenantId), eq(crmDealFiles.dealId, md.dealId)))
                  .orderBy(desc(crmDealFiles.createdAt))
                  .limit(10)
                  .catch(() => []),
                db
                  .select()
                  .from(crmDealQuestionnaires)
                  .where(and(eq(crmDealQuestionnaires.tenantId, tenantId), eq(crmDealQuestionnaires.dealId, md.dealId)))
                  .orderBy(desc(crmDealQuestionnaires.createdAt))
                  .catch(() => []),
                db
                  .select()
                  .from(crmDealEmails)
                  .where(and(eq(crmDealEmails.tenantId, tenantId), eq(crmDealEmails.dealId, md.dealId)))
                  .orderBy(desc(crmDealEmails.createdAt))
                  .limit(10)
                  .catch(() => []),
              ]);

            // Evidências / mensagens vinculadas às atividades (se houver atividades)
            const actIds = acts.map((a) => a.id);
            const actMessages =
              actIds.length > 0
                ? await db
                    .select({
                      activityId: crmActivityMessages.activityId,
                      content: crmActivityMessages.content,
                      createdAt: crmActivityMessages.createdAt,
                    })
                    .from(crmActivityMessages)
                    .where(
                      and(
                        eq(crmActivityMessages.tenantId, tenantId),
                        inArray(crmActivityMessages.activityId, actIds)
                      )
                    )
                    .orderBy(desc(crmActivityMessages.createdAt))
                    .limit(10)
                    .catch(() => [])
                : [];

            // 1) Dados gerais e datas da negociação
            const statusPt =
              enriched?.status === "open"
                ? "Em andamento (Aberta)"
                : enriched?.status === "paused"
                ? `Pausada${enriched?.pausedReason ? ` (Motivo: ${enriched.pausedReason})` : ""}`
                : enriched?.status === "won"
                ? "Ganha / Vendida"
                : enriched?.status === "lost"
                ? `Perdida${enriched?.lossReason ? ` (Motivo: ${enriched.lossReason})` : ""}`
                : md.status || "Em andamento";

            const ratingStr =
              enriched?.rating && Number(enriched.rating) > 0
                ? `${enriched.rating}/5 estrelas`
                : "Sem avaliação de estrelas";

            // 2) Empresa vinculada (crm_accounts)
            const accTypeStr =
              enriched?.accountType === "company"
                ? "Pessoa Jurídica (PJ)"
                : enriched?.accountType === "person"
                ? "Pessoa Física (PF)"
                : "Pessoa Jurídica (PJ)";
            const accDetails: string[] = [];
            if (enriched?.accountName) {
              accDetails.push(`Razão Social / Nome: ${enriched.accountName} | Tipo: ${accTypeStr}`);
              if (enriched.accountTradeName) accDetails.push(`Nome Fantasia: ${enriched.accountTradeName}`);
              if (enriched.accountDocument) {
                accDetails.push(
                  `${(enriched.accountDocumentType || "CNPJ/CPF").toUpperCase()}: ${enriched.accountDocument}`
                );
              }
              if (enriched.accountSegment) accDetails.push(`Segmento: ${enriched.accountSegment}`);
              if (enriched.accountPhone) accDetails.push(`Telefone da Empresa: ${enriched.accountPhone}`);
              if (enriched.accountEmail) accDetails.push(`E-mail da Empresa: ${enriched.accountEmail}`);
              if (enriched.accountWebsite) accDetails.push(`Website: ${enriched.accountWebsite}`);
              if (enriched.accountNotes) accDetails.push(`Observações da Empresa: ${enriched.accountNotes}`);
              if (enriched.accountCustomFieldsDecoded?.filledLines?.length > 0) {
                accDetails.push(
                  `Campos Personalizados da Empresa: ${enriched.accountCustomFieldsDecoded.inlineSummary}`
                );
              }
            } else {
              accDetails.push("Nenhuma empresa vinculada ao card.");
            }

            // 3) Contatos vinculados (CONTATOS)
            const contactsList: any[] = enriched?.allContacts || [];
            const contactsSection =
              contactsList.length > 0
                ? contactsList
                    .map((c, idx) => {
                      const parts = [
                        `${idx + 1}. Nome: ${c.name}`,
                        `Papel: ${c.roleLabel}${c.isPrimary ? " (Contato Principal)" : ""}`,
                        `Telefone (VigosPhone/WhatsApp): ${c.phone || "Não informado"}`,
                        `E-mail: ${c.email || "Não informado"}`,
                      ];
                      if (c.cnpj) parts.push(`CNPJ: ${c.cnpj}`);
                      if (c.cpf) parts.push(`CPF: ${c.cpf}`);
                      if (Array.isArray(c.tags) && c.tags.length > 0) parts.push(`Tags: ${c.tags.join(", ")}`);
                      if (c.customFieldsDecoded?.inlineSummary) {
                        parts.push(`Campos Personalizados do Contato: ${c.customFieldsDecoded.inlineSummary}`);
                      }
                      return `      - ${parts.join(" | ")}`;
                    })
                    .join("\n")
                : `      - Nome: ${md.contactName || "Não informado"} | Telefone: ${md.contactPhone || "Não cadastrado"} | E-mail: ${enriched?.contactEmail || "Não informado"}`;

            // 4) Campos Personalizados da Negociação (CAMPOS PERSONALIZADOS)
            const cfDecoded: DecodedCustomFieldsResult | undefined = enriched?.dealCustomFieldsDecoded;
            const filledCfLines =
              cfDecoded && cfDecoded.filledLines.length > 0
                ? cfDecoded.filledLines.map((line) => `      - [PREENCHIDO] ${line}`).join("\n")
                : "      - Nenhum campo personalizado preenchido nesta negociação.";
            const emptyCfSummary =
              cfDecoded && cfDecoded.emptyLabels.length > 0
                ? `      - Campos personalizados em branco / não preenchidos (${cfDecoded.emptyLabels.length}): ${cfDecoded.emptyLabels.join(", ")}`
                : "";

            // 5) Produtos e Propostas
            const productsSummary =
              dealProducts.length > 0
                ? dealProducts
                    .map(
                      (p) =>
                        `      - Produto: "${p.name}"${p.sku ? ` (SKU: ${p.sku})` : ""} | Qtd: ${p.quantity} | Unitário: ${formatBrl(Number(p.unitPrice || 0))} | Desconto: ${formatBrl(Number(p.discount || 0))} | Total Item: ${formatBrl(Number(p.total || 0))}${p.notes ? ` | Obs: ${p.notes}` : ""}`
                    )
                    .join("\n")
                : "      - Nenhum produto cadastrado na aba Produtos deste card.";

            const proposalsSummary =
              dealProposals.length > 0
                ? dealProposals
                    .map(
                      (pr) =>
                        `      - Proposta #${pr.proposalNumber} "${pr.title}" | Status: ${pr.status} | Valor Total: ${formatBrl(Number(pr.total || 0))}${pr.validUntil ? ` | Validade: ${pr.validUntil}` : ""}${pr.notes ? ` | Notas: ${pr.notes.slice(0, 120)}` : ""}`
                    )
                    .join("\n")
                : "      - Nenhuma proposta formal emitida na aba Propostas.";

            // 6) Tarefas, Ligações, Reuniões e Notas do Card
            const pendingActs = acts.filter((a) => a.status === "pending");
            const historyActs = acts.filter((a) => a.status !== "pending");
            const formatActLine = (a: (typeof acts)[number]) => {
              const dtCreated = formatDateTimeBrt(a.createdAt);
              const dtDue = a.dueDate ? ` | Prazo: ${formatDateTimeBrt(a.dueDate)}` : "";
              const dtDone = a.completedAt ? ` | Concluída em: ${formatDateTimeBrt(a.completedAt)}` : "";
              return `      - [${a.type.toUpperCase()} | Status: ${a.status} | Criada: ${dtCreated}${dtDue}${dtDone}] ${a.title}${a.description ? ` — Detalhes/Nota: ${a.description.slice(0, 250)}` : ""}`;
            };
            const pendingActsSummary =
              pendingActs.length > 0
                ? pendingActs.map(formatActLine).join("\n")
                : "      - Nenhuma próxima tarefa pendente agendada para este card.";
            const historyActsSummary =
              historyActs.length > 0
                ? historyActs.map(formatActLine).join("\n")
                : "      - Nenhuma tarefa concluída ou nota manual registrada na aba Tarefas & Notas.";

            // 7) Questionários, Arquivos, E-mails, Eventos e Evidências
            const questSummary =
              dealQuestionnaires.length > 0
                ? dealQuestionnaires
                    .map(
                      (qItem) =>
                        `      - Questionário "${qItem.title}" | Status: ${qItem.status} (${qItem.filledCount}/${qItem.totalCount} respondidas)`
                    )
                    .join("\n")
                : "      - Nenhum questionário vinculado.";

            const filesSummary =
              dealFiles.length > 0
                ? dealFiles
                    .map(
                      (f) =>
                        `      - Arquivo "${f.name}" (Categoria: ${f.category} | Tipo: ${f.mimeType || "arquivo"} | Data: ${formatDateTimeBrt(f.createdAt)})`
                    )
                    .join("\n")
                : "      - Nenhum arquivo anexado na aba Arquivos.";

            const emailsSummary =
              dealEmails.length > 0
                ? dealEmails
                    .map(
                      (em) =>
                        `      - [${formatDateTimeBrt(em.sentAt || em.createdAt)} | Status: ${em.status}] Assunto: "${em.subject}" (De: ${em.fromEmail} -> Para: ${em.toEmail})`
                    )
                    .join("\n")
                : "      - Nenhum e-mail registrado na aba E-mail.";

            const eventsSummary =
              dealEvents.length > 0
                ? dealEvents
                    .slice(0, 6)
                    .map(
                      (ev) =>
                        `      - [${formatDateTimeBrt(ev.createdAt)} | Evento: ${ev.type}]${ev.fromStageId || ev.toStageId ? ` Mudança de etapa (${ev.fromStageId || "?"} -> ${ev.toStageId || "?"})` : ""}`
                    )
                    .join("\n")
                : "      - Sem eventos adicionais de movimentação registrados.";

            const evidencesSummary =
              actMessages.length > 0
                ? actMessages
                    .map((am) => `      - [${formatDateTimeBrt(am.createdAt)}] Evidência: "${am.content.slice(0, 180)}"`)
                    .join("\n")
                : "      - Nenhuma evidência vinculada.";

            dealDeepLines.push(
              `  📌 FICHA COMPLETA 360º DO CARD CRM: "${md.title}" (dealId: ${md.dealId})\n` +
                `    • DADOS GERAIS & DATAS:\n` +
                `      - Título da Negociação: ${md.title}\n` +
                `      - Status Atual: ${statusPt}\n` +
                `      - Funil e Etapa: ${md.pipelineName || "Geral"} > ${md.stageName || "N/A"}\n` +
                `      - Valor Total: ${formatBrl(Number(md.value || 0))} (${enriched?.currency || "BRL"})\n` +
                `      - Qualificação / Avaliação (Avaliar): ${ratingStr}\n` +
                `      - Criado em: ${formatDateTimeBrt(enriched?.createdAt)}\n` +
                `      - Atualizado em: ${formatDateTimeBrt(enriched?.updatedAt)}\n` +
                `      - Última atividade registrada: ${formatDateTimeBrt(enriched?.lastActivityAt || enriched?.updatedAt)} (Parada há ${md.daysIdle ?? 0} dia(s))\n` +
                `      - Previsão de Fechamento: ${formatDateOnlyBrt(enriched?.expectedCloseDate)}\n` +
                `      - Origem / Fonte: ${enriched?.source || "Não informada"}${enriched?.campaign ? ` | Campanha: ${enriched.campaign}` : ""}${enriched?.rdDealUrl ? ` | Link RD: ${enriched.rdDealUrl}` : ""}\n` +
                `    • EMPRESA VINCULADA (ABA EMPRESA):\n` +
                `      - ${accDetails.join("\n      - ")}\n` +
                `    • CONTATOS VINCULADOS (${contactsList.length || 1} contato(s)):\n` +
                `${contactsSection}\n` +
                `    • CAMPOS PERSONALIZADOS DA NEGOCIAÇÃO (${cfDecoded?.filledCount || 0} preenchido(s) de ${cfDecoded?.totalApplicable || 0} campos do funil):\n` +
                `${filledCfLines}${emptyCfSummary ? `\n${emptyCfSummary}` : ""}\n` +
                `    • PRODUTOS VINCULADOS (ABA PRODUTOS — ${dealProducts.length}):\n` +
                `${productsSummary}\n` +
                `    • PROPOSTAS COMERCIAIS (${dealProposals.length}):\n` +
                `${proposalsSummary}\n` +
                `    • PRÓXIMAS TAREFAS AGENDADAS (${pendingActs.length}):\n` +
                `${pendingActsSummary}\n` +
                `    • TAREFAS CONCLUÍDAS & NOTAS DO CARD (${historyActs.length}):\n` +
                `${historyActsSummary}\n` +
                `    • HISTÓRICO DE EVENTOS (${dealEvents.length}):\n` +
                `${eventsSummary}\n` +
                `    • QUESTIONÁRIOS (${dealQuestionnaires.length}):\n` +
                `${questSummary}\n` +
                `    • ARQUIVOS ANEXADOS (${dealFiles.length}):\n` +
                `${filesSummary}\n` +
                `    • E-MAILS (${dealEmails.length}):\n` +
                `${emailsSummary}\n` +
                `    • EVIDÊNCIAS (${actMessages.length}):\n` +
                `${evidencesSummary}\n` +
                `    • CONVERSA WHATSAPP VINCULADA: ${md.conversationId ? `Sim (convId: ${md.conversationId})` : "Sem conversa ativa vinculada no WhatsApp no momento (inclua o dealId em mentionedDealIds para exibir o card interativo com botão do CRM e VigosPhone)"}`
            );
          }
          sections.push(
            `🔍 FICHA COMPLETA 360º DA(S) NEGOCIAÇÃO(ÕES) DO CRM EM FOCO (TODOS OS CAMPOS PERSONALIZADOS, CONTATOS, EMPRESA, DATAS E ABAS):\n${dealDeepLines.join("\n\n")}`
          );
        }

        if (searchTerms.length > 0) {
          const matchedConvs = activeConvs.filter((c) => {
            const hay = normalizeForMatch(`${c.contactName || ""} ${c.contactCompany || ""} ${c.dealTitle || ""}`);
            return searchTerms.some((t) => hay.includes(t));
          });

          let extraOwnConvs: typeof activeConvs = [];
          if (matchedConvs.length === 0) {
            const likeFilters = searchTerms.map((t) => ilike(contacts.name, `%${t}%`));
            const rawExtra = await db
              .select({
                id: conversations.id,
                contactId: conversations.contactId,
                contactName: contacts.name,
                contactPhone: contacts.phone,
                contactCompany: crmAccounts.name,
                lastMessage: conversations.lastMessageText,
                lastTime: conversations.lastMessageTime,
                lastClientMsg: conversations.lastClientMessageAt,
                lastOpMsg: conversations.lastOperatorMessageAt,
                createdAt: conversations.createdAt,
                queueState: conversations.queueState,
                unread: conversations.unreadCount,
              })
              .from(conversations)
              .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)))
              .leftJoin(crmAccounts, and(eq(crmAccounts.id, contacts.accountId), eq(crmAccounts.tenantId, tenantId)))
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  eq(conversations.operatorId, operatorId),
                  or(...likeFilters)
                )
              )
              .orderBy(desc(conversations.lastMessageTime))
              .limit(3);

            extraOwnConvs = rawExtra.map((c) => ({ ...c, dealTitle: null, funnelName: null }));
          }

          const targetConvs = [...matchedConvs, ...extraOwnConvs].slice(0, 2);
          if (targetConvs.length > 0) {
            const deepDetails: string[] = [];
            for (const tc of targetConvs) {
              if (!knownConvMap.has(tc.id)) {
                knownConvMap.set(tc.id, {
                  clientId: tc.id,
                  clientName: tc.contactName,
                  clientPhone: tc.contactPhone || null,
                  company: tc.contactCompany || null,
                  lastMessage: tc.lastMessage || null,
                  dealTitle: tc.dealTitle || null,
                  funnelName: tc.funnelName || null,
                });
              }

              const recentMsgs = await db
                .select({
                  senderType: messages.senderType,
                  content: messages.content,
                  mediaInterpretation: messages.mediaInterpretation,
                  sentAt: messages.sentAt,
                })
                .from(messages)
                .where(
                  and(
                    eq(messages.conversationId, tc.id),
                    eq(messages.tenantId, tenantId),
                    eq(messages.isInternalNote, false)
                  )
                )
                .orderBy(desc(messages.sentAt))
                .limit(12);

              const orderedMsgs = recentMsgs.reverse();
              const transcript = orderedMsgs
                .map((m) => {
                  const hora = m.sentAt
                    ? new Date(m.sentAt).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "";
                  const who = m.senderType === "client" ? "Cliente" : m.senderType === "bot" ? "IA Triagem" : "Você";
                  const txt = (m.content || m.mediaInterpretation || "[Mídia]").slice(0, 180);
                  return `    [${hora}] ${who}: ${txt}`;
                })
                .join("\n");

              deepDetails.push(
                `  📌 Cliente: ${tc.contactName}${tc.contactCompany ? ` (${tc.contactCompany})` : ""}${tc.contactPhone ? ` | 📞 Tel: ${tc.contactPhone}` : ""} (convId: ${tc.id}) | Fila: ${tc.queueState}${tc.dealTitle ? ` | Negociação: ${tc.dealTitle}` : ""}\n  Últimas mensagens da conversa:\n${transcript}`
              );
            }
            sections.push(`🔍 HISTÓRICO DETALHADO DO(S) CLIENTE(S) CONSULTADO(S):\n${deepDetails.join("\n\n")}`);
          }

          // 5.3 Guarda de Sigilo: Verifica se o termo buscado pertence a OUTRO operador (apenas quando não é envio puro de imagem)
          if (
            !hasAttachedImage &&
            targetConvs.length === 0 &&
            matchedDeals.length === 0 &&
            primaryTerms.length > 0
          ) {
            const dealLikeFilters = primaryTerms.map((t) => ilike(crmDeals.title, `%${t}%`));
            const thirdPartyDeals = await db
              .select({
                title: crmDeals.title,
                otherOperatorId: crmDeals.operatorId,
              })
              .from(crmDeals)
              .where(
                and(
                  eq(crmDeals.tenantId, tenantId),
                  ne(crmDeals.operatorId, operatorId),
                  or(...dealLikeFilters)
                )
              )
              .limit(3);

            const contactLikeFilters = primaryTerms.map((t) => ilike(contacts.name, `%${t}%`));
            const thirdPartyConvs = await db
              .select({
                contactName: contacts.name,
                otherOperatorId: conversations.operatorId,
              })
              .from(conversations)
              .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)))
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  ne(conversations.operatorId, operatorId),
                  or(...contactLikeFilters)
                )
              )
              .limit(3);

            if (thirdPartyDeals.length > 0 || thirdPartyConvs.length > 0) {
              isThirdPartyBlocked = true;
              const matchedNames = [
                ...thirdPartyDeals.map((d) => d.title),
                ...thirdPartyConvs.map((c) => c.contactName),
              ].slice(0, 3);
              sections.push(
                `🔒 ALERTA DE SIGILO COMERCIAL (DADOS DE TERCEIROS DETECTADOS NA PERGUNTA):\n` +
                  `  • O vendedor perguntou sobre "${matchedNames.join(", ")}", que pertence à carteira de OUTRO vendedor/operador.\n` +
                  `  • REGRA INVIOLÁVEL: Informe educadamente em 1 único balão curto que esse cliente/negociação está na carteira de outro consultor e que, por política de sigilo comercial, você só pode consultar clientes da carteira do próprio vendedor logado.\n` +
                  `  • PROIBIDO EMPURRAR OUTROS CARDS: NÃO sugira outras negociações aleatórias (como BOLOS & BOLOS ou JJL PLASTIC) quando bloquear uma consulta de terceiros, e deixe mentionedDealIds, suggestedCallDealIds e mentionedConversationIds vazios ([]).`
              );
            }
          }
        }

        if (matchedDeals.length > 0 || isThirdPartyBlocked) {
          const deepMs = Math.max(10, Date.now() - tDeep0);
          const targetDesc =
            matchedDeals.length > 0
              ? matchedDeals
                  .slice(0, 2)
                  .map((d) => d.title)
                  .join(", ")
              : (primaryTerms.length > 0 ? primaryTerms : searchTerms).join(", ");
          pushRealStep({
            id: "step-op-deepsearch",
            kind: "search",
            actionVerb: "Inspecionou",
            targetLabel: `"${targetDesc.slice(0, 60)}"`,
            scopeTag: isThirdPartyBlocked
              ? `#sigilo-rbac • ${deepMs}ms`
              : `#ficha-360-completa • ${deepMs}ms`,
            badgeType: "sql",
            detailText: isThirdPartyBlocked
              ? `Verificação de titularidade RBAC concluída em ${deepMs}ms (registro pertence a outra carteira).`
              : `Ficha completa 360º (campos personalizados, contatos, e-mail, empresa, datas, produtos, tarefas e histórico) carregada em ${deepMs}ms.`,
          });
        }
      } catch (deepErr: any) {
        console.warn("[getOperatorContext] Aviso na busca profunda:", deepErr?.message);
      }
    }

    // ── 6. MÉTRICAS DE ATENDIMENTO DO DIA ────────────────────────────────────
    if (shouldRunMetrics) {
      const tMet0 = Date.now();
      try {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
        const dailyMetrics = await db
          .select()
          .from(operatorDailyMetrics)
          .where(
            and(
              eq(operatorDailyMetrics.tenantId, tenantId),
              eq(operatorDailyMetrics.operatorId, operatorId),
              eq(operatorDailyMetrics.date, today)
            )
          )
          .limit(1);

        if (dailyMetrics.length > 0) {
          const m = dailyMetrics[0];
          const tma = m.avgResponseTimeSeconds
            ? `${Math.floor(m.avgResponseTimeSeconds / 60)}min ${m.avgResponseTimeSeconds % 60}s`
            : "N/A";
          sections.push(
            `📊 SUAS MÉTRICAS DE ATENDIMENTO DE HOJE:\n  • Total conversas: ${m.totalConversations}\n  • TMA (Tempo Médio de Resposta): ${tma}\n  • SLA estourados hoje: ${m.overdueCount}\n  • Score médio IA: ${m.avgPerformanceScore || "N/A"}/100`
          );
          const metMs = Math.max(8, Date.now() - tMet0);
          pushRealStep({
            id: "step-op-metrics",
            kind: "query",
            actionVerb: "Consultou",
            targetLabel: "operator_daily_metrics",
            scopeTag: `#tma-${tma} • ${metMs}ms`,
            badgeType: "sla",
            detailText: `Métricas individuais de hoje lidas em ${metMs}ms.`,
          });
        }
      } catch (metricsErr: any) {
        console.warn("[getOperatorContext] Aviso ao carregar métricas do dia:", metricsErr?.message);
      }
    }

    // ── 7. BASE DE CONHECIMENTO / CATÁLOGO DE MÁQUINAS E PRODUTOS + LOJA VTEX ──
    let vtexLookupResult: VtexAssistantLookupResult | null = null;
    if (shouldRunKb) {
      const tKb0 = Date.now();
      try {
        if (!shouldRunDeals) {
          pushRealStep({
            id: "step-op-kb-analyze",
            kind: "analyze",
            actionVerb: "Analisou",
            targetLabel: "parâmetros técnicos, catálogo de equipamentos & loja VTEX",
            scopeTag: "#1037-maquinas • #210-manuais • #vtex",
            badgeType: "kb",
            detailText: `Cruzando a aplicação, capacidade produtiva, especificações e página da VTEX de "${(cleanUserQuery || userQuery || "").slice(0, 80)}" com as linhas de máquinas e manuais técnicos disponíveis.`,
          });
        }
        const kbQuery = [
          cleanUserQuery,
          imageFileName ? imageFileName.replace(/\.[a-z0-9]{2,5}$/i, "") : "",
          (isExplicitPhotoRequest || (isFollowUpRequest && isRecentMachineManualTurn)) && recentAiContextText
            ? recentAiContextText.slice(-450)
            : "",
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

        const tVtex0 = Date.now();
        const [kbContext, vtexRes] = await Promise.all([
          getKnowledgeBaseContext(tenantId, kbQuery || userQuery),
          tenantId === "tecfag"
            ? lookupVtexProductsForAssistant({
                tenantId,
                userQuery: cleanUserQuery || userQuery || "",
                recentHistoryText: recentAiContextText || "",
                forceLookup: vtexIntent.shouldQueryVtex,
              }).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (kbContext) {
          sections.push(kbContext);
          const kbMs = Math.max(10, Date.now() - tKb0);
          pushRealStep({
            id: "step-op-kb",
            kind: "search",
            actionVerb: "Consultou",
            targetLabel: "knowledge_base",
            scopeTag: `#catalogo-tecnico • ${kbMs}ms`,
            badgeType: "kb",
            detailText: `Manuais técnicos em PDF e Catálogo Oficial de Máquinas consultados na Base de Conhecimento em ${kbMs}ms.`,
          });
        }

        if (vtexRes && vtexRes.invoked && vtexRes.products.length > 0) {
          vtexLookupResult = vtexRes;
          sections.push(vtexRes.promptContext);
          const vtexMs = Math.max(15, Date.now() - tVtex0);
          const hasFullPage = vtexRes.products.some((p) => p.pageReadComplete);
          pushRealStep({
            id: "step-op-vtex",
            kind: "search",
            actionVerb: hasFullPage ? "Consultou VTEX & leu página" : "Consultou loja VTEX",
            targetLabel: vtexRes.products
              .map((p) => `${p.name} (SKU ${p.skuId})`)
              .join(", ")
              .slice(0, 75),
            scopeTag: `#vtex-live • ${vtexMs}ms`,
            badgeType: "kb",
            detailText: `Consulta ao vivo na loja VTEX (www.tecfag.com.br)${hasFullPage ? " e leitura completa da página do produto (/p)" : ""} concluídas em ${vtexMs}ms.`,
          });
        }
      } catch {}
    }

    // ── 8. GUIA OFICIAL DE NAVEGAÇÃO DO SISTEMA (ONBOARDING WIZARD) ──────────
    const systemGuideSources: KnowledgeSourceItem[] = [];
    if (systemGuideMatch.isSystemHowTo && systemGuideMatch.promptContext) {
      sections.push(systemGuideMatch.promptContext);
      const primaryPlaybook = systemGuideMatch.matchedPlaybooks[0];
      pushRealStep({
        id: "step-op-wizard-guide",
        kind: "read",
        actionVerb: "Consultou guia do sistema",
        targetLabel: primaryPlaybook?.title || "Fagner Onboarding Wizard (237 steps)",
        scopeTag: "#onboarding-wizard",
        badgeType: "kb",
        detailText: "Passos de interface, botões e fluxos operacionais carregados do Guia Oficial do Sistema (Wizard).",
      });
      systemGuideSources.push({
        id: `wizard-guide-${primaryPlaybook?.id || "general"}`,
        kind: "system_guide",
        title: primaryPlaybook?.title || "Guia Oficial do Sistema (Fagner Onboarding Wizard)",
        code: primaryPlaybook?.routePath || "/inicio",
        folderOrCategory: `Onboarding Wizard • ${primaryPlaybook?.moduleLabel || "Navegação do Sistema"}`,
        excerptOrDetail:
          primaryPlaybook?.whereToClick ||
          "Instruções passo a passo de botões, abas e fluxos operacionais do sistema.",
        verified: true,
      });
    }

    return {
      contextText: sections.join("\n\n"),
      knownConversations: Array.from(knownConvMap.values()),
      waitingConversations,
      todayLeadsConversations,
      knownDeals: Array.from(knownDealMap.values()),
      scheduledCallActions,
      executedSteps,
      taskTitle,
      finishedTitle,
      isCasual: false,
      isThirdPartyBlocked,
      isPureKbQuery,
      isSystemGuideQuery: systemGuideMatch.isSystemHowTo,
      vtexLookupResult,
      systemGuideSources,
    };
  } catch (err: any) {
    console.error("[getOperatorContext] Erro:", err);
    return {
      contextText: sections.length > 0 ? sections.join("\n\n") : "Sem dados adicionais no momento.",
      knownConversations: Array.from(knownConvMap.values()),
      waitingConversations,
      todayLeadsConversations,
      knownDeals: Array.from(knownDealMap.values()),
      scheduledCallActions,
      executedSteps,
      taskTitle,
      finishedTitle,
      isCasual: false,
      isThirdPartyBlocked,
      isPureKbQuery,
      isSystemGuideQuery: systemGuideMatch.isSystemHowTo,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXTO DA DIRETORIA / GESTÃO — Visão global 360º da operação em tempo real
// Usado exclusivamente em: Módulo IA Administrativa (ValentinaChatTab), scope = "admin"
// NÃO afeta o Fagner/Valentina Colega do operador (scope = "operator")
// ═══════════════════════════════════════════════════════════════════════════════
async function getManagerContext(
  tenantId: string,
  userQuery?: string,
  knowledgeBase?: string
): Promise<string> {
  return getDirectorBiContext(tenantId, userQuery, knowledgeBase);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPTS DAS PERSONAS
// ═══════════════════════════════════════════════════════════════════════════════

function getBrasiliaNowLabel(): string {
  const now = new Date();
  const datePart = now.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timePart = now.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart}, às ${timePart} (Horário de Brasília - America/Sao_Paulo)`;
}

function buildSupervisorPrompt(
  persona: ReturnType<typeof getAiPersona>,
  operatorName: string,
  operationalContext: string,
  fileContext: string,
  chatHistoryText: string,
  userMessage: string,
  hasAttachedImage?: boolean,
  imageFileName?: string
): string {
  const genderRole =
    persona.gender === "male"
      ? "o Diretor de Business Intelligence, Operações e Gestão Comercial em Tempo Real"
      : "a Diretora de Business Intelligence, Operações e Gestão Comercial em Tempo Real";
  const brtNowLabel = getBrasiliaNowLabel();

  return `Você é ${persona.name}, ${genderRole} da ${persona.company}.
Você está conversando diretamente com "${operatorName}" (Diretoria / Gestão Executiva) no painel administrativo exclusivo da Diretoria.
📅 DATA E HORA ATUAL (HORÁRIO DE BRASÍLIA): ${brtNowLabel}.

## 🏛️ SEU PAPEL E ACESSO TOTAL À OPERAÇÃO:
1. **ACESSO 100% COMPLETO E EM TEMPO REAL**:
   - Você JÁ POSSUI acesso integral a todos os dados da operação no dossiê abaixo:
     * **Seção 1**: Filas em tempo real e Ranking de Gargalos por Operador (conversas ativas, clientes aguardando resposta agora, espera >= 15min [SLA estourado], alerta 8-14min, espera máxima e média por operador, e nomes dos clientes esperando).
     * **Seção 2**: Tempo Médio de Atendimento (TMA) Geral e por Operador (Hoje, Últimos 7 dias, Últimos 30 dias e TMA de 1ª Resposta Pós-Transferência do SDR no mês, além do operador mais rápido e mais lento).
     * **Seção 3**: Taxa de Conversão do SDR / Triagem Automática (Hoje, Últimos 7 dias e Geral: total de leads, qualificados/transferidos, em coleta, sem resposta, interrompidos, distribuição por funil/setor e lista nominal dos leads triados).
     * **Seção 4**: Alertas de Estouro de SLA Hoje, nos últimos 7 dias e conversas com SLA estourado ao vivo neste exato minuto.
     * **Seção 5**: Funil de Vendas Comercial (Desta Semana, do Mês e Pipeline Geral por Etapa e por Funil, mais Funil Ponta a Ponta Marketing/SDR -> CRM -> Fechamento).
     * **Seção 6**: Relatório Detalhado por Vendedor / Consultor (Meta Mensal, Realizado no Mês e na Semana, % da Meta, Pacing de Dias Úteis, Pipeline Aberto, Negociações Paradas >=3 dias, Perdidos, Fila de WhatsApp e TMA por vendedor, além das Top Negociações Abertas, Paradas e Ganhas).
     * **Seção 7**: Objeções dos Leads nas Conversas (Preço, Especificação Técnica, Prazo/Frete, Pagamento/Boleto, Garantia/Peças com exemplos reais de falas de clientes), Motivos de Perda no CRM e Auditorias de Qualidade/Sentimento.
     * **Seção 8**: Top 5 Principais Alertas da Operação Hoje (síntese executiva priorizada por criticidade).
     * **Seção 9**: Escala do Rodízio (consultores ativos, pausados, saldo de compensação) e Telemetria de Custos de IA.
     * **Seção 10 e 11**: Busca Profunda sob demanda (conversas com transcrição, negociações e empresas específicas) e Catálogo/Base de Conhecimento.
     * **Seção 12 (VTEX Ao Vivo & Página Completa do Produto)**: Consulta em tempo real à loja oficial VTEX (https://www.tecfag.com.br) com preços públicos em R$, SKUs, códigos internos (PAMQ...), estoque, simulação de frete e leitura integral da página web do equipamento no site (com envio automático do link e preview da máquina em um balão separado).
     * **Seção 13 (Guia Oficial do Sistema & Onboarding Wizard)**: Domínio completo de todas as telas, botões, fluxos e ações operacionais/administrativas do sistema para orientar passo a passo onde clicar.

2. **REGRA INVIOLÁVEL — PROIBIDO DIZER "NÃO TENHO ACESSO", PROIBIDO INVENTAR DADOS FICTÍCIOS E PROIBIDO USAR EMOJIS**:
   - **JAMAIS** responda que "não tem acesso", "não consigo consultar", "os dados não estão disponíveis no contexto" ou que houve "falha no início do ciclo / erro na compilação da métrica".
   - **PROIBIÇÃO ABSOLUTA DE ALUCINAÇÃO (FIDELIDADE 100% AO DOSSIÊ)**: Você SÓ pode citar nomes de operadores/vendedores, nomes de clientes/empresas, CNPJs, valores em R$ e quantidades que estejam **literalmente escritos** no dossiê abaixo (\`DADOS REAIS DA OPERAÇÃO AGORA\`). **JAMAIS** invente nomes fictícios de exemplo (como "Ana Paula", "Carlos Dias", "Mecânica Souza Ltda", "Construtora Alfa", "Agropecuária do Vale") nem números fictícios (como "48 alertas" ou "3 conversas")!
   - Quando um indicador específico estiver em \`0\` no dossiê (por exemplo: \`0 alertas de SLA disparados hoje\` e \`0 conversas com SLA estourado agora\`), **informe com exatidão que o número é 0 (operação 100% dentro do SLA no momento)** e mostre nos blocos visuais os indicadores reais correlatos do dossiê (como operadores ativos na escala do rodízio, volume de negociações abertas/paradas no CRM dos vendedores reais da empresa, ou histórico real de 7 dias), **nunca fabricando clientes ou operadores inexistentes**.
   - **PROIBIÇÃO ABSOLUTA DE EMOJIS**: O sistema utiliza exclusivamente ícones vetoriais nativos na interface. **JAMAIS** inclua emojis no texto das suas respostas ou dentro dos blocos.
${
  hasAttachedImage
    ? `\n4. **ANÁLISE VISUAL MULTIMODAL DE IMAGEM / FOTO ANEXADA**:
   - O gestor enviou uma imagem real anexada nesta mensagem${imageFileName ? ` (referência: "${imageFileName}")` : ""}.
   - Analise diretamente os pixels da imagem enviada com máxima precisão e fidelidade visual, sem inventar especificações ou dados que não estejam visíveis na foto ou no dossiê.\n`
    : ""
}
3. **USO OBRIGATÓRIO E INTELIGENTE DE BLOCOS VISUAIS (\`"blocks"\` COM DADOS 100% REAIS DO DOSSIÊ)**:
   - Sempre que a pergunta envolver métricas, comparativos, rankings, funil, relatórios ou objeções, enriqueça sua resposta com **1 ou 2 blocos visuais** dentro do array \`"blocks"\` usando **exclusivamente** os números e nomes reais do dossiê:
     * **Perguntas sobre TMA**: Traga a análise executiva em \`"text"\` + um \`InsightBlock\` (com os valores reais do dossiê de TMA Hoje, 7d, 30d e Pós-SDR) + um \`ChartBlock\` (\`"bar"\`, unit \`"min"\` ou \`"s"\`) se houver operadores com TMA medido (se todos estiverem em 0/N/A, use um \`ReportBlock\` com os operadores reais da equipe e seu status atual).
     * **Perguntas sobre Gargalo de Fila por Operador**: Traga a resposta direta em \`"text"\` + um \`ReportBlock\` ou \`ChartBlock\` (\`"bar"\`) com os operadores reais listados na Seção 1 / Seção 6 / Seção 9 + um \`InsightBlock\` apontando o status real da fila agora.
     * **Perguntas sobre Taxa de Conversão do SDR**: Traga a taxa real de hoje, dos últimos 7 dias e geral em \`"text"\` + um \`InsightBlock\` com os KPIs reais da Seção 3 + um \`ChartBlock\` ou \`ReportBlock\` mostrando o funil real.
     * **Perguntas sobre Alertas de Estouro de SLA ou 5 Principais Alertas da Operação**: Traga o diagnóstico fiel da Seção 4 e Seção 8 em \`"text"\` + um \`InsightBlock\` com os números exatos da Seção 4 (se houver 0 estouros de SLA agora, destaque positivamente que há 0 estouros de SLA no WhatsApp e traga no \`ReportBlock\` os alertas reais da Seção 8, como as negociações reais paradas no CRM com seus respectivos vendedores reais).
     * **Perguntas sobre Gráfico do Funil de Vendas desta Semana**: Gere obrigatoriamente um \`ChartBlock\` (\`"bar"\`) com as etapas e quantidades/valores reais do funil comercial da Seção 5 + um \`ReportBlock\` ou \`InsightBlock\` detalhando quantidade e valor (R$) real em cada etapa.
     * **Perguntas sobre Relatório Detalhado por Vendedor**: Gere obrigatoriamente um \`ReportBlock\` completo com os vendedores reais da Seção 6 (Colunas sugeridas: \`["Vendedor", "Divisão", "Meta Mês", "Realizado Mês", "Pipeline Aberto", "Parados >=3d", "Perdidos Mês"]\`) + um \`InsightBlock\` com o resumo da meta global e realizado real da empresa.
     * **Perguntas sobre Objeções dos Leads**: Gere um \`ChartBlock\` (\`"bar"\` ou \`"pie"\`) com o ranking real das categorias/objeções da Seção 7 (usando as 5 macro-categorias e os Top 12 motivos específicos de perda do CRM quando a amostra de mensagens do chat estiver em 0) + um \`ReportBlock\` ou \`InsightBlock\` detalhando os valores em R$ e ocorrências reais.
     * **Perguntas sobre Preços/Máquinas na VTEX ou Como Usar o Sistema (Wizard)**: Quando o gestor perguntar sobre preço, estoque, página de uma máquina na VTEX ou como realizar uma ação no sistema, responda de forma direta e completa usando as seções \`🛒 DADOS EM TEMPO REAL DA LOJA VTEX\` e \`🧭 GUIA OFICIAL DE NAVEGAÇÃO DO SISTEMA & ONBOARDING WIZARD\`. Quando houver máquina localizada na VTEX, o sistema anexará automaticamente um **balão separado logo abaixo** com o card de preview oficial da VTEX e o link direto para abrir no site.

${getCompactSystemNavigationCheatSheet()}

## DADOS REAIS DA OPERAÇÃO AGORA (DOSSIÊ EXECUTIVO 360º):
${operationalContext}
${fileContext}

${chatHistoryText ? `## HISTÓRICO RECENTE DESTA CONVERSA:\n${chatHistoryText}\n` : ""}
## SOLICITAÇÃO ATUAL DO GESTOR (${operatorName}):
"${userMessage}"

## ESTRUTURA DE BLOCOS VISUAIS SUPORTADOS (use dentro de "blocks" no JSON):
1. ChartBlock: { "type": "chart", "chart": "bar"|"line"|"pie", "title": "...", "subtitle": "...", "unit": "...", "data": [{ "label": "X", "value": 10 }] }
2. InsightBlock: { "type": "insight", "title": "...", "items": [{ "label": "...", "value": "...", "delta": "+5%", "trend": "up"|"down"|"flat", "hint": "..." }], "recommendation": "..." }
3. ReportBlock: { "type": "report", "title": "...", "columns": ["Col1","Col2"], "rows": [["val1","val2"]], "footnote": "..." }
4. ExcerptBlock: { "type": "excerpt", "title": "...", "conversations": [{ "lead": "...", "channel": "WhatsApp", "when": "Recente", "sentiment": "positivo"|"neutro"|"negativo", "lines": [{ "from": "lead"|"agente", "text": "..." }] }] }

## FORMATO OBRIGATÓRIO DE RESPOSTA (JSON VÁLIDO):
{
  "fragments": [
    {
      "text": "Análise executiva direta, clara e completa respondendo à pergunta do gestor com os números reais da operação (sem emojis e sem repetir de forma idêntica o que já está desenhado na tabela/gráfico abaixo, mas interpretando os destaques e gargalos).",
      "delay": 0,
      "blocks": [ ... ]
    }
  ]
}`;
}

function buildColeaguePrompt(
  persona: ReturnType<typeof getAiPersona>,
  operatorName: string,
  operatorContext: string,
  fileContext: string,
  chatHistoryText: string,
  userMessage: string,
  alreadyTalkingToday: boolean,
  hasAttachedImage?: boolean,
  imageFileName?: string
): string {
  const isMale = persona.gender === "male";
  const colleagueRole = isMale ? "colega de equipe e copiloto comercial" : "colega de equipe e copiloto comercial";
  const firstName = operatorName.split(" ")[0] || operatorName;
  const brtNowLabel = getBrasiliaNowLabel();

  return `Você é ${persona.name}, ${colleagueRole} de vendas e atendimento da ${persona.company}.
Você trabalha lado a lado com ${operatorName} (consultor(a)/vendedor(a)) durante o dia a dia comercial no WhatsApp interno.
DATA E HORA ATUAL (HORÁRIO DE BRASÍLIA): ${brtNowLabel}.
ATENÇÃO TEMPORAL: No histórico da conversa abaixo, cada mensagem possui um marcador temporal exato (\`[Hoje HH:mm]\`, \`[Ontem DD/MM HH:mm]\` ou \`[DD/MM/YYYY HH:mm]\`). Nunca trate assuntos ou perguntas marcadas como \`[Hoje ...]\` como se fossem de ontem, e nunca trate alertas antigos de \`[Ontem ...]\` como se estivessem acontecendo agora.

## SEU PAPEL NO DIA A DIA DO VENDEDOR:
Você NÃO é um suporte de T.I. (nunca fale em "chamados de T.I." ou "tickets"). Você é um colega de trabalho afiado, direto e prestativo que ajuda ${firstName} com:
1. **Leads e Atendimentos de Hoje / Conversas Ativas / SLA**: Quantos leads chegaram hoje, quais clientes estão aguardando resposta no WhatsApp (e há quantos minutos), quais foram transferidos recentemente, resumo do que o cliente falou e sugestões de mensagens de abordagem, contorno de objeções ou follow-up.
2. **Metas e Ritmo Comercial**: Quanto falta para bater a meta do mês, quanto já vendeu, qual a meta diária necessária e quantos dias úteis restam.
3. **Tarefas, Reuniões e Diretrizes do Gestor**: Quais tarefas estão pendentes para hoje ou atrasadas e quais orientações o gestor deixou nas negociações.
4. **Ligações Agendadas e Discagem Direta via VigosPhone**: Quais ligações e follow-ups ${firstName} precisa fazer hoje e atalho direto para ligar via VigosPhone.
5. **MENSURAÇÃO 100% COMPLETA DA CARTEIRA E LISTAGEM DE NEGOCIAÇÕES (CRM)**: Você enxerga **100% de todas as negociações** de ${firstName} no CRM (sem nenhum limite de 60 registros — você vê todas as milhares de negociações: abertas, ganhas, pausadas e perdidas, além da mensuração matemática completa por status, por faixa de valor, por tempo sem interação/aging e por cada Funil e Etapa).
6. **Análise Visual de Fotos/Imagens e Domínio Completo dos Manuais Técnicos e Catálogo (RAG)**: Inspeção visual real de fotos de máquinas, ferramentas, peças ou prints enviados por ${firstName} + consulta direta aos **210 Manuais Técnicos Oficiais (PDFs extraídos na Base de Conhecimento RAG)** e ao **Catálogo Oficial de Máquinas da ${persona.company}**.
7. **Integração em Tempo Real com a Loja VTEX e Leitura Completa da Página do Produto no Site**: Consulta ao vivo à loja oficial VTEX (https://www.tecfag.com.br) trazendo **preços públicos em R$, valores de tabela, SKUs VTEX, códigos internos ERP (PAMQ...), disponibilidade em estoque, simulação de frete por CEP e leitura integral da página web do equipamento no site**, além de entregar automaticamente o **link direto da máquina em um balão separado com o card oficial de preview da VTEX**.
8. **Guia Completo de Uso do Sistema e Onboarding Wizard (Onde Clicar / Passo a Passo)**: Domínio completo de todas as telas, botões, ícones e fluxos do sistema (com base nos 8 capítulos e 237 passos do Onboarding Wizard oficial) para ensinar ${firstName} exatamente **onde clicar e como realizar qualquer ação no sistema** (ex: transferir um cliente, assumir da fila, vincular ou criar negociação no chat, concluir diretriz com evidência, usar notas internas, enviar template Meta 24h, consultar CNPJ na Receita Federal, etc.).

## CONSULTAS TÉCNICAS DE MÁQUINAS, MODELOS, MANUAIS E LOJA VTEX AO VIVO:
1. **DOMÍNIO TOTAL DOS MANUAIS TÉCNICOS, DO CATÁLOGO OFICIAL E DA PÁGINA INTEIRA DO PRODUTO NA VTEX**:
   - Quando ${firstName} perguntar sobre qualquer máquina, código, preço, estoque, link do site ou pedir mais informações sobre um equipamento (ex: *"O que sabe sobre a APF300-2B?"*, *"Preciso de mais informações sobre a máquina X"*, *"Qual o preço da VS-500 na VTEX?"*, *"Lê a página da DZ-400 no site"*, *"Me manda o link dessa máquina"*), consulte imediatamente:
     a) A seção \`🛒 DADOS EM TEMPO REAL DA LOJA VTEX & LEITURA COMPLETA DA PÁGINA DO PRODUTO NO SITE\` (que traz o preço público em R$ na VTEX, SKU, código interno PAMQ..., disponibilidade de estoque, simulação de frete e o **conteúdo integral lido diretamente da página web do produto no site https://www.tecfag.com.br**);
     b) A seção \`📚 BASE DE CONHECIMENTO & DIRETRIZES\` (que traz os dados do **Catálogo Oficial** e o texto extraído do **Manual Técnico PDF**).
   - **JAMAIS** diga que *"Não encontrei o catálogo técnico ou as especificações"* ou que *"Não tenho acesso aos preços / ao site"* quando o modelo estiver listado na seção VTEX ou na Base de Conhecimento!
   - **COMBINE O MANUAL TÉCNICO + A LEITURA DA PÁGINA VTEX**: Entregue uma resposta completa, prática e organizada unindo os **dados comerciais ao vivo da VTEX** (nome oficial na loja, SKU VTEX, Código Interno ERP \`PAMQ...\`, **preço público em R$**, disponibilidade em estoque e condições/frete quando houver) com as **especificações técnicas completas lidas da página inteira do site e do Manual PDF** (aplicação, funcionamento, faixa de dosagem/produção, tensão, potência, pressão de ar, dimensões, estrutura em Inox, etc.).
   - **ENTREGA DO LINK DA MÁQUINA EM BALÃO SEPARADO COM PREVIEW OFICIAL DA VTEX**:
     * Sempre que uma máquina for localizada na VTEX (em perguntas sobre informações da máquina, preço, estoque, página ou link), o sistema **anexará automaticamente um balão separado logo abaixo da sua resposta** contendo o **Card de Preview Oficial da VTEX** (com a foto da máquina vinda da própria VTEX, título, SKU, preço em R$, resumo descritivo e botão clicável para ${firstName} abrir a página direto no site).
     * Portanto, nos seus balões de texto, concentre-se em passar os valores, preços e informações técnicas/comerciais completas da máquina, e avise de forma natural que está enviando logo abaixo o card com o link direto do site para ele abrir (não precisa colar a URL crua \`https://...\` repetida no meio do texto quando o card de preview da VTEX estiver disponível).
   - **NÃO DESVIE PARA CRM SE A PERGUNTA FOR SOBRE MÁQUINA / VTEX**: Se ${firstName} fez uma pergunta sobre máquina, preço, estoque ou catálogo/VTEX, responda 100% focado no equipamento e deixe \`"mentionedDealIds": []\` vazio.
2. **REGRA INVIOLÁVEL DE SINCERIDADE TÉCNICA E ANTI-ALUCINAÇÃO (QUANDO NÃO SOUBER, DIGA QUE NÃO SABE!)**:
   - Separe com rigor absoluto **o que consta na VTEX / manual / catálogo** do que **não consta**:
   - Quando ${firstName} perguntar sobre um detalhe técnico específico ou sobre um preço/equipamento que **NÃO esteja escrito** na seção VTEX, nos Manuais Técnicos ou no Catálogo Oficial fornecidos no contexto abaixo, **JAMAIS chute, JAMAIS deduza e JAMAIS invente preços ou especificações!**
   - **Seja 100% sincero e transparente**: passe com segurança tudo o que consta na VTEX e no manual/catálogo sobre a máquina e avise com naturalidade caso algum detalhe específico não conste na documentação ou caso o item esteja sob consulta na loja.

## AUXÍLIO OPERACIONAL E PASSO A PASSO DE USO DO SISTEMA (ONBOARDING WIZARD INJETADO):
1. **COMO ENSINAR ${firstName.toUpperCase()} A REALIZAR QUALQUER AÇÃO NO SISTEMA (ONDE CLICAR)**:
   - Sempre que ${firstName} perguntar como fazer algo no sistema (ex: *"Como posso transferir um cliente?"*, *"Onde clico para assumir um lead da fila?"*, *"Como vinculo uma negociação na conversa?"*, *"Como concluo uma diretriz do gestor com evidência?"*, *"Como uso notas internas ou respostas rápidas?"*, *"Como funciona o template Meta de 24h?"*, *"Como puxo os dados do CNPJ no sistema?"*), consulte a seção \`🧭 GUIA OFICIAL DE NAVEGAÇÃO DO SISTEMA & ONBOARDING WIZARD\` no contexto abaixo e o mapa de navegação do sistema.
   - Explique de forma **clara, direta e passo a passo**, indicando exatamente:
     1. **Qual módulo na barra lateral esquerda** ou **qual painel da tela** acessar (ex: Painel Esquerdo da Fila, Cabeçalho Superior do Chat Central, Compositor de Mensagem no Rodapé ou Painel Direito de Contexto CRM);
     2. **Qual botão ou ícone clicar** (ex: botão **"Transferir"** com ícone de seta dupla no cabeçalho superior da conversa, ao lado de "Finalizar");
     3. **O que selecionar ou preencher no modal** (ex: escolher a aba **"Para Operador"** ou **"Para Setor"**, adicionar o motivo opcional e clicar em **"Confirmar Transferência"**);
     4. **O que acontece no sistema após a ação** (ex: registro automático no histórico de eventos da conversa e preservação das negociações vinculadas).
   - Quando a pergunta for sobre **como usar o sistema**, mantenha \`"mentionedDealIds": []\`, \`"mentionedConversationIds": []\` e \`"suggestedCallDealIds": []\` vazios.

${getCompactSystemNavigationCheatSheet()}
${
  hasAttachedImage
    ? `
## ANÁLISE VISUAL DE IMAGEM / FOTO ENVIADA PELO VENDEDOR (MODO MULTIMODAL ATIVO):
1. **INSPEÇÃO VISUAL REAL DOS PIXELS DA FOTO**:
   - ${firstName} acabou de enviar uma **IMAGEM / FOTO REAL** anexada nesta mensagem${imageFileName ? ` (nome de referência do arquivo: "${imageFileName}")` : ""}.
   - Os pixels reais da imagem estão anexados diretamente na entrada multimodal desta chamada. **INSPECIONE VISUALMENTE A IMAGEM COM ATENÇÃO TOTAL!**
2. **REGRA INVIOLÁVEL CONTRA ALUCINAÇÃO E MENTIRA**:
   - Descreva e responda com base no que **REALMENTE APARECE VISUALMENTE NA FOTO** (ex: formato físico do equipamento/ferramenta, mecanismo de acionamento/alavancas, cor, material da estrutura, painel, rótulos visíveis na peça ou texto visível em um print) combinado com os dados oficiais da seção \`📚 CATÁLOGO / BASE DE CONHECIMENTO\` e \`🛒 LOJA VTEX\` (quando o item constar abaixo).
   - **PROIBIDO INVENTAR OU CHUTAR ESPECIFICAÇÕES TÉCNICAS**: Se um dado técnico específico (como voltagem, potência em W, largura/espessura exata de fita em mm, peso exato em kg, capacidade produtiva ou preço) **NÃO estiver visível na foto** e **NÃO constar na Base de Conhecimento/VTEX abaixo**, **JAMAIS invente números ou especificações!** Descreva com precisão o equipamento/ferramenta que você está vendo na foto, explique sua aplicação prática real e informe com transparência quais medidas/especificações exatas não estão visíveis na imagem e precisam ser conferidas na ficha técnica.
   - **NÃO EMPURRE CARDS DE CRM**: Como o foco é a análise da foto enviada, mantenha \`"mentionedDealIds": []\`, \`"suggestedCallDealIds": []\` e \`"mentionedConversationIds": []\` vazios, a menos que ${firstName} tenha pedido explicitamente uma negociação junto com a foto.
`
    : ""
}
## REGRA INVIOLÁVEL DE MENSURAÇÃO E LISTAGEM (PROIBIDO ENROLAR OU PEDIR CONFIRMAÇÃO!):
1. **PROIBIDO DIZER "60 NEGOCIAÇÕES"**:
   - Você tem acesso à totalidade absoluta da carteira de ${firstName} na seção \`📊 RAIO-X E MENSURAÇÃO 100% COMPLETA DA SUA CARTEIRA NO CRM\`. **JAMAIS** diga que existem apenas 60 negociações! Use sempre os números exatos do Raio-X (ex: total geral da carteira, total de abertas, pausadas, ganhas e perdidas).
2. **PROIBIDO ENROLAR, PEDIR CONFIRMAÇÃO OU PERGUNTAR "COMO PREFERE VER?"**:
   - **JAMAIS** responda frases evasivas como *"Tem certeza que quer que eu liste todas?"*, *"Quer mesmo que eu mande tudo?"*, *"A lista completa vai ficar gigante aqui no WhatsApp. Que tal eu filtrar pra você? Como você prefere ver?"* ou *"Prefere que eu filtre por funil ou valor?"*.
   - Sempre que ${firstName} pedir para **listar todas as negociações, ver a lista completa, saber quantas negociações tem ou mensurar a carteira**, **ENTREGUE OS DADOS IMEDIATAMENTE NA MESMA RESPOSTA** divididos em 3 balões objetivos:
     * **1º Balão (Mensuração Global 100% da Carteira)**: Informe o Total Geral de negociações vinculadas ao nome de ${firstName} e o valor global, detalhando exatamente quantas estão **Em Andamento (Abertas)** + valor em R$ (e quantas possuem valor preenchido vs R$ 0,00), quantas estão **Ganhas**, **Pausadas** e **Perdidas**, além da **Saúde/Aging das Abertas** (quantas ativas <3d, esfriando 3-7d, paradas >7d e >30d).
     * **2º Balão (Mensuração por Funil e Principais Etapas)**: Apresente a distribuição exata por Funil (quantidade de abertas, total e valor em R$ de cada funil, e as principais etapas com mais volume/valor) usando os números reais da seção \`📂 MENSURAÇÃO COMPLETA POR FUNIL E POR ETAPA\`.
     * **3º Balão (Listagem Nominal das Principais Negociações + Cards Interativos)**: Liste nominalmente no texto as principais negociações em aberto (com código, empresa, etapa e valor em R$) e preencha \`"mentionedDealIds"\` com os IDs das negociações listadas no contexto para que o painel interativo rolável de negociações seja exibido logo abaixo.

## VISÃO 360º COMPLETA DE CADA NEGOCIAÇÃO E CAMPOS PERSONALIZADOS DO CRM (PROIBIDO OMITIR DADOS!):
1. **ACESSO TOTAL AOS CAMPOS PERSONALIZADOS E DADOS DO CARD**:
   - Você enxerga **100% das informações de cada negociação** tanto no resumo de cada linha (\`Campos Personalizados Preenchidos: [...]\`) quanto na seção \`🔍 FICHA COMPLETA 360º DA(S) NEGOCIAÇÃO(ÕES) DO CRM EM FOCO\`:
     * **Campos Personalizados da Negociação** (ex: *CLIENTE NOVO?*, *QUALIFICADO POR SDR*, *PROPOSTA NEXT*, *QUAL O PRODUTO FABRICADO?*, *VOLUME DE PRODUÇÃO*, *QUAL O TIPO DE PRODUTO DO CLIENTE*, etc.), sabendo exatamente quais estão preenchidos e quais estão em branco.
     * **Contatos Vinculados Completos**: Nome, papel/cargo (ex: *COMPRADOR - Contato Principal*), telefone e **e-mail** do contato.
     * **Empresa Vinculada**: Razão social, tipo (*Pessoa Jurídica - PJ* ou *PF*), CNPJ/documento, segmento e contatos da empresa.
     * **Datas, Qualificação e Origem**: Data e hora exata de criação (*Criado em*), última atualização (*Atualizado em*), *Previsão de Fechamento*, avaliação em estrelas (*Qualificação: X/5 estrelas*) e origem/campanha.
     * **Todas as Abas da Negociação**: *Produtos*, *Propostas*, *Próximas tarefas*, *Tarefas & Notas*, *Histórico de Eventos*, *Questionários*, *Arquivos*, *E-mails*, *Evidências* e *Conversas*.
2. **PROIBIDO DIZER QUE "NÃO HÁ CAMPOS CUSTOMIZADOS" OU QUE "SÓ TEM PREVISÃO DE FECHAMENTO"**:
   - **JAMAIS** confunda *Previsão de Fechamento* com campo personalizado e **JAMAIS** diga que *"não há outros campos customizados registrados"* quando a negociação tiver campos personalizados listados no contexto!
   - Quando ${firstName} perguntar *"que informações a mais você possui dela?"*, *"quais os detalhes dessa negociação?"* ou *"ela não tem algum campo customizado preenchido?"*, entregue todos os detalhes reais da Ficha 360º de forma organizada (empresa PJ/PF, contato com papel, telefone e e-mail, datas de criação e atualização, avaliação em estrelas, **todos os campos personalizados preenchidos com nome e valor exato**, quais campos personalizados estão em branco e o status das abas de produtos/tarefas/histórico).

## ESTILO DE CONVERSA NATURAL (COMO UM COLEGA NO WHATSAPP):
1. **DIVIDA EM BALÕES CURTOS (1 A 3 FRAGMENTOS)**:
   - Em agradecimentos ou confirmações rápidas (ex: *"ta obrigado"*, *"valeu"*, *"beleza"*, *"ok"*), responda em **1 único balão curto** (1 frase natural, sem puxar novos assuntos ou empurrar atendimentos).
   - Em consultas comerciais, técnicas ou passo a passo de uso do sistema, quebre sua resposta em **2 a 3 balões** dentro do array \`"fragments"\`.
2. **PROIBIDO CUMPRIMENTAR TODA HORA**:
   - ${
     alreadyTalkingToday
       ? `**VOCÊS JÁ ESTÃO CONVERSANDO HOJE!** Veja o histórico abaixo. É **ESTRITAMENTE PROIBIDO** começar a resposta com saudação ("Fala, ${firstName}!", "E aí, ${firstName}!", "Bom dia", "Boa tarde", "Olá", "Tudo certo?", "Opa"). Responda DIRETO ao ponto como em uma conversa contínua de WhatsApp!`
       : `Como é a primeira troca de mensagens de hoje, se ${firstName} mandou um cumprimento ("Oi", "Olá", "Bom dia"), responda de forma curta e natural apenas no primeiro balão.`
   }
3. **PROIBIDO EMPURRAR ATENDIMENTOS OU NEGOCIAÇÕES NÃO SOLICITADOS (ZERO POLUIÇÃO)**:
   - **NUNCA** empurre negociações paradas, leads ou sugestões de ligação se ${firstName} não perguntou por indicações/prioridades agora.
   - Se ${firstName} apenas agradeceu (*"ta obrigado"*, *"valeu"*), encerre de forma leve sem anexar nenhum card (\`"mentionedConversationIds": []\`, \`"mentionedDealIds": []\`, \`"suggestedCallDealIds": []\`).
   - Se ${firstName} perguntou sobre um cliente/negociação de outro vendedor (bloqueado por sigilo comercial) ou que não foi encontrado na carteira, informe apenas isso de forma objetiva — **JAMAIS** ofereça outras negociações aleatórias da carteira como "compensação".
4. **PROIBIDO USAR EMOJIS E PROIBIDO REPETIR BORDÕES**:
   - **PROIBIÇÃO ABSOLUTA DE EMOJIS**: O sistema utiliza exclusivamente ícones nativos na interface. **JAMAIS** inclua emojis em nenhuma mensagem!
   - **NUNCA** use as palavras **"parceiro"**, **"parceira"**, **"campeão"**, **"fera"**, **"chefe"**, **"meu caro"** ou **"amigo"**.
   - **NÃO** fique repetindo o nome "${firstName}" em toda mensagem ou em todo balão.
   - **NUNCA** use frases de fechamento batidas/repetitivas como *"Qualquer coisa estou na escuta"*, *"Fico na escuta"*, *"É só chamar"*, *"Estou por aqui"*, *"Bora pra cima"*, *"Bons negócios"*.
5. **FORMATAÇÃO LIMPA DE WHATSAPP (PROIBIDO USAR CRASE / BACKTICKS \` \`)**:
   - **JAMAIS** use crases (\`0017418\`) para destacar códigos ou nomes. Use apenas negrito simples do WhatsApp (\`*0017418*\` ou \`**0017418**\`).
   - **JAMAIS** escreva \`[ID: ...]\`, \`[dealId: ...]\` ou \`[convId: ...]\` no texto visível de \`"text"\`. Coloque os IDs exclusivamente nos arrays do JSON (\`"mentionedConversationIds"\`, \`"mentionedDealIds"\`, \`"suggestedCallDealIds"\`).
6. **CARDS UNIFICADOS DE NEGOCIAÇÕES (\`"mentionedDealIds"\`)**:
   - Cada Card de Negociação em \`"mentionedDealIds"\` **já possui embutidos** o telefone do cliente, o botão de discagem direta no VigosPhone, o atalho da conversa no WhatsApp e o botão **"Abrir CRM →"**.
   - Quando citar uma negociação específica, coloque o ID em \`"mentionedDealIds"\`. Quando ${firstName} pedir uma lista ampla/completa de negociações, inclua em \`"mentionedDealIds"\` até 20 IDs relevantes (o sistema completará automaticamente a lista interativa rolável).
   - Use \`"suggestedCallDealIds"\` **apenas** quando o foco específico for uma ligação agendada hoje ou quando não houver card de CRM correspondente.
   - Use \`"mentionedConversationIds"\` **apenas** quando citar conversas de WhatsApp que não sejam negociações já listadas em \`"mentionedDealIds"\`.

## REGRAS INVIOLÁVEIS DE SIGILO E SEGURANÇA (RBAC):
- Você tem acesso EXCLUSIVO à carteira, metas, tarefas, clientes e negociações de **${operatorName}**.
- **PROIBIDO** revelar, estimar ou comentar sobre negociações de terceiros (outros vendedores/operadores), ranking confidencial de salários/comissões de colegas ou dados estratégicos/financeiros restritos à Diretoria.
- Use SEMPRE os dados reais fornecidos abaixo. Nunca invente valores, telefones, nomes de clientes ou tarefas que não estejam listados no contexto.

## DADOS COMERCIAIS E OPERACIONAIS DE ${operatorName.toUpperCase()} AGORA:
${operatorContext}
${fileContext}

${chatHistoryText ? `## HISTÓRICO RECENTE DA CONVERSA COM ${operatorName.toUpperCase()}:\n${chatHistoryText}\n` : ""}
## MENSAGEM ATUAL DE ${operatorName.toUpperCase()}:
"${userMessage}"

## FORMATO OBRIGATÓRIO DE RESPOSTA (JSON):
{
  "fragments": [
    {
      "text": "Primeiro balão curto e direto (sem emojis, sem saudação repetida e sem palavras-muleta)",
      "delay": 0
    }
  ],
  "mentionedConversationIds": [],
  "mentionedDealIds": [],
  "suggestedCallDealIds": []
}`;
}

function stripAllEmojis(text: string): string {
  return (text || "")
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{200D}\u{FE0E}\u{FE0F}]/gu,
      ""
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// ── Helpers para Pós-Processamento de Balões Naturais e Conversas Citadas ───
function cleanColleagueText(
  text: string,
  operatorName: string,
  alreadyTalkingToday: boolean,
  isFirstBubble: boolean
): string {
  let out = stripAllEmojis(text || "");
  const firstName = (operatorName.split(" ")[0] || operatorName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Remove bordões/muletas proibidas ("parceiro", "parceira", "campeão", "fera")
  out = out
    .replace(/,\s*\b(meu\s+)?(parceir[oa]|campe[aã]o|fera|chefe)\b([!.,?])/gi, "$3")
    .replace(/\b(meu\s+)?(parceir[oa]|campe[aã]o|fera)\b[,!]?\s*/gi, "");

  // Remove saudações repetidas quando já estão conversando hoje
  if (alreadyTalkingToday && isFirstBubble) {
    const greetingRegex = new RegExp(
      `^(?:fala|e\\s+a[íi]|opa|ol[áa]|oi|bom\\s+dia|boa\\s+tarde|boa\\s+noite|tudo\\s+certo|beleza)(?:\\s*,?\\s*${firstName})?[!,.:?]*\\s*(?:(?:bom\\s+dia|boa\\s+tarde|boa\\s+noite|tudo\\s+certo|tudo\\s+bem|como\\s+vai)[!,.:?]*\\s*)*`,
      "i"
    );
    const stripped = out.replace(greetingRegex, "").trim();
    if (stripped.length > 10) {
      out = stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }
  }

  // Remove fechamentos robóticos repetitivos no final
  out = out
    .replace(/\s*(?:qualquer\s+coisa\s+)?(?:estou|fico|tô)\s+(?:por\s+aqui|na\s+escuta|à\s+disposição)[^.!?\n]*[.!?]?\s*$/i, "")
    .trim();

  // Remove vazamento acidental de "[ID: ...]", "[dealId: ...]", "[convId: ...]" no texto visível
  out = out
    .replace(/\s*\[(?:ID|dealId|convId):\s*[^\]]+\]/gi, "")
    .replace(/\s*\((?:ID|dealId|convId):\s*[^)]+\)/gi, "")
    .trim();

  // Converte crases inline (`0017418`) em negrito limpo de WhatsApp (*0017418*)
  out = out.replace(/`([^`\n]+)`/g, "*$1*");

  return out || stripAllEmojis(text || "");
}

function splitIntoNaturalFragments(
  rawFragments: { text: string; delay?: number; blocks?: any[] }[],
  operatorName: string,
  alreadyTalkingToday: boolean,
  maxBubbles = 4
): { text: string; delay: number; blocks?: any[] }[] {
  const cleanedInput = rawFragments
    .map((f, idx) => ({
      ...f,
      text: cleanColleagueText(f.text, operatorName, alreadyTalkingToday, idx === 0),
    }))
    .filter((f) => f.text.length > 0 || (f.blocks && f.blocks.length > 0));

  if (cleanedInput.length === 0) return [];

  // Se a IA já retornou 2 a 4 balões bem divididos, apenas garante que nenhum balão único seja gigante
  const finalBubbles: { text: string; delay: number; blocks?: any[] }[] = [];

  for (const frag of cleanedInput) {
    // Se tiver blocks (modo supervisor), preserva como está
    if (frag.blocks && frag.blocks.length > 0) {
      finalBubbles.push({
        text: frag.text,
        delay: finalBubbles.length * 650,
        blocks: frag.blocks,
      });
      continue;
    }

    // Divide por quebras de parágrafo duplas se o balão for longo (> 260 chars), se só veio 1 balão com vários parágrafos
    // ou se houver múltiplas apresentações de modelos ("Essa é a ...", "Aqui a ...") agrupadas no mesmo fragmento
    const paragraphs = frag.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    const hasMultipleModelCaptions =
      paragraphs.length > 1 &&
      paragraphs.filter((p) =>
        /^(?:Essa\s+[eé]\s+a|Aqui\s+a|Este\s+[eé]\s+o|Temos\s+tamb[eé]m|E\s+por\s+fim)/i.test(p)
      ).length >= 2;

    if (
      paragraphs.length > 1 &&
      (cleanedInput.length === 1 || frag.text.length > 260 || hasMultipleModelCaptions)
    ) {
      for (const p of paragraphs) {
        finalBubbles.push({
          text: p,
          delay: finalBubbles.length * 650,
        });
      }
    } else if (cleanedInput.length === 1 && frag.text.length > 260 && !frag.text.includes("\n")) {
      // Se veio 1 bloco só sem quebras de linha mas com várias frases longas, divide em 2 balões por frases
      const sentences = frag.text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [frag.text];
      if (sentences.length >= 2) {
        const mid = Math.ceil(sentences.length / 2);
        const part1 = sentences.slice(0, mid).join(" ").trim();
        const part2 = sentences.slice(mid).join(" ").trim();
        if (part1) finalBubbles.push({ text: part1, delay: finalBubbles.length * 650 });
        if (part2) finalBubbles.push({ text: part2, delay: finalBubbles.length * 650 });
      } else {
        finalBubbles.push({ text: frag.text, delay: finalBubbles.length * 650 });
      }
    } else {
      finalBubbles.push({
        text: frag.text,
        delay: finalBubbles.length * 650,
      });
    }
  }

  // Limita ao número máximo de balões do turno (4 no padrão, ou até 12 em galerias de múltiplos modelos)
  const effectiveMax = Math.max(1, maxBubbles);
  if (finalBubbles.length > effectiveMax) {
    const keepCount = effectiveMax - 1;
    const firstPart = finalBubbles.slice(0, keepCount);
    const restText = finalBubbles
      .slice(keepCount)
      .map((b) => b.text)
      .join("\n\n");
    return [
      ...firstPart,
      {
        text: restText,
        delay: keepCount * 650,
        blocks: finalBubbles[finalBubbles.length - 1].blocks,
      },
    ];
  }

  return finalBubbles;
}

const GENERIC_NON_SPECIFIC_DEAL_NAMES = new Set([
  "envasadora", "envasadoras", "seladora", "seladoras", "rotuladora", "rotuladoras",
  "datador", "datadores", "empacotadora", "empacotadoras", "dosadora", "dosadoras",
  "encapsuladora", "encapsuladoras", "arqueadora", "arqueadoras", "fechadora", "fechadoras",
  "enfardadeira", "enfardadeiras", "cartonadora", "cartonadoras", "blister", "tunel",
  "esteira", "esteiras", "maquina", "maquinas", "equipamento", "equipamentos",
  "personnalite", "valvula", "valvulas", "frasco", "frascos", "pote", "potes",
  "tampa", "tampas", "peca", "pecas", "manual", "catalogo", "cliente", "empresa",
  "comercio", "industria", "ltda", "eireli", "dora", "automatica", "automatico",
  "semiautomatica", "semiautomatico", "bancada", "pedal", "continua", "vacuo",
  "liquido", "liquidos", "pastoso", "pastosos", "bico", "bicos",
]);

function containsWholeNormalizedPhrase(haystackNorm: string, phraseNorm: string): boolean {
  const clean = phraseNorm.trim();
  if (!clean) return false;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i");
  return re.test(haystackNorm);
}

function isSpecificEnoughDealPhrase(phraseNorm: string): boolean {
  const clean = phraseNorm.trim();
  if (clean.length < 4) return false;
  if (GENERIC_NON_SPECIFIC_DEAL_NAMES.has(clean)) return false;
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    // Palavra única sem código numérico precisa ter pelo menos 6 caracteres e não ser termo genérico
    if (clean.length < 6 || GENERIC_NON_SPECIFIC_DEAL_NAMES.has(clean)) return false;
  } else if (tokens.every((t) => GENERIC_NON_SPECIFIC_DEAL_NAMES.has(t) || t.length <= 2)) {
    return false;
  }
  return true;
}

function isSecrecyOrEmptyRefusalReply(fullReplyText: string, ctx: OperatorContextResult | null): boolean {
  if (ctx?.isCasual || ctx?.isThirdPartyBlocked || ctx?.isPureKbQuery) return true;
  const text = fullReplyText || "";
  if (
    /sigilo\s+comercial|carteira\s+de\s+outro\s+consultor|outro\s+vendedor|exclusiv[oa]\s+de\s+outro\s+consultor/i.test(
      text
    )
  ) {
    return true;
  }
  if (
    /\b(?:n[aã]o\s+h[aá]\s+nenhum\s+cliente|nenhum\s+cliente\s+aguardando|caixa\s+de\s+entrada\s+est[aá]\s+em\s+dia|n[aã]o\s+tem\s+nenhum\s+cliente|zero\s+clientes?\s+aguardando|sua\s+fila\s+est[aá]\s+em\s+dia|fila\s+est[aá]\s+zerada|n[aã]o\s+encontrei\s+nenhum[a]?\s+(?:cliente|negocia[cç][aã]o|conversa))\b/i.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

function resolveRelatedDeals(
  mentionedDealIds: string[],
  suggestedCallDealIds: string[],
  fullReplyText: string,
  userText: string,
  ctx: OperatorContextResult | null,
  operatorName?: string
): RelatedDealItem[] {
  if (!ctx || ctx.knownDeals.length === 0) return [];
  if (isSecrecyOrEmptyRefusalReply(fullReplyText, ctx)) return [];

  const hasExplicitCrmListWord =
    /\b(?:negocia[çc][aã]o|negocia[çc][oõ]es|cards?|crm|carteira|pipeline|funil|etapa|propostas?|or[çc]amentos?)\b/i.test(
      userText
    );
  const asksPureWhatsAppQueue =
    !hasExplicitCrmListWord &&
    /\b(?:aguardando|esperando|fila|caixa\s+de\s+entrada|sem\s+resposta)\b/i.test(userText);

  const selectedMap = new Map<string, RelatedDealItem>();
  const byId = new Map(ctx.knownDeals.map((d) => [d.dealId, d]));

  // 1. IDs explicitamente retornados pela IA em mentionedDealIds ou suggestedCallDealIds (prioridade máxima)
  for (const id of [...mentionedDealIds, ...suggestedCallDealIds]) {
    const cleanId = (id || "").trim();
    const found = byId.get(cleanId);
    if (found) selectedMap.set(found.dealId, found);
  }

  // Se a pergunta foi puramente sobre a fila de espera do WhatsApp e a IA não citou IDs de negociações, não vasculha o texto para anexar cards de CRM
  if (asksPureWhatsAppQueue && selectedMap.size === 0) {
    return [];
  }

  // Ignora o próprio nome do operador logado (ex: "Tarcisio, dei uma olhada...") para não dar match falso em cards de teste com o nome do vendedor
  const opFullNorm = normalizeForMatch(operatorName || "");
  const opFirstNorm = opFullNorm.split(/\s+/)[0] || "";
  const normUser = normalizeForMatch(userText);
  const userExplicitlyTypedOpName =
    Boolean(opFirstNorm && opFirstNorm.length >= 3 && containsWholeNormalizedPhrase(normUser, opFirstNorm));

  const isOperatorSelfNamePhrase = (phraseNorm: string) => {
    if (!phraseNorm || userExplicitlyTypedOpName) return false;
    if (opFirstNorm && phraseNorm === opFirstNorm) return true;
    if (opFullNorm && phraseNorm === opFullNorm) return true;
    return false;
  };

  // 2. Negociações citadas nominalmente ou por código numérico no texto da resposta da IA
  // Usa fronteira de palavra inteira (\b) e bloqueia termos genéricos de máquinas (como "Envasadora" ou sufixo "dora" dentro de "envasadora")
  const normReply = normalizeForMatch(fullReplyText);
  for (const deal of ctx.knownDeals) {
    if (selectedMap.size >= 50) break;
    const titleNorm = normalizeForMatch(deal.title || "");
    const companyNorm = normalizeForMatch(deal.company || "");
    const codeMatch = (deal.title || "").match(/\b(\d{4,})\b/);
    const codeToken = codeMatch ? codeMatch[1] : "";

    const matchedByCode =
      codeToken.length >= 4 && containsWholeNormalizedPhrase(normReply, codeToken);
    const matchedByTitle =
      !isOperatorSelfNamePhrase(titleNorm) &&
      isSpecificEnoughDealPhrase(titleNorm) &&
      containsWholeNormalizedPhrase(normReply, titleNorm);
    const matchedByCompany =
      !isOperatorSelfNamePhrase(companyNorm) &&
      isSpecificEnoughDealPhrase(companyNorm) &&
      containsWholeNormalizedPhrase(normReply, companyNorm);

    if (matchedByCode || matchedByTitle || matchedByCompany) {
      selectedMap.set(deal.dealId, deal);
    }
  }

  // 3. Detecta se o operador pediu listagem completa/ampla ou plural de negociações do CRM
  const isTechnicalMachineReply =
    !hasExplicitCrmListWord &&
    /\b(?:ihm|touch\s+screen|volume\s+de\s+envase|velocidade\s+da\s+esteira|ciclos\s+por\s+minuto|manual\s+t[eé]cnico|segundo\s+o\s+cat[aá]logo|faixa\s+de\s+dosagem|seladora|envasadora|rotuladora|datador|empacotadora|dosadora|encapsuladora|arqueadora|t[uú]nel\s+de\s+encolhimento)\b/i.test(
      `${userText} ${fullReplyText}`
    );

  const asksFullOrBroadList =
    !isTechnicalMachineReply &&
    !asksPureWhatsAppQueue &&
    (/\b(?:minhas\s+negocia[çc][oõ]es|meus\s+cards|mensur[aeo]|mensura[çc][aã]o|carteira\s+completa|pipeline\s+completo)\b/i.test(
      userText
    ) ||
      (hasExplicitCrmListWord &&
        /\b(?:todas|todos|tudo|lista\s+completa|listar|liste|funil|etapa)\b/i.test(userText)));
  const asksPluralList =
    !isTechnicalMachineReply &&
    !asksPureWhatsAppQueue &&
    /\b(?:quais|lista|paradas|parados|abertas|abertos|maiores|propostas|or[çc]amentos|negocia[çc][oõ]es)\b/i.test(
      userText
    );

  // Se o operador pediu a lista completa / todas as negociações, preenche até 50 cards interativos
  // priorizando o filtro da pergunta (ex: funil/etapa/termo) ou as principais negociações da carteira
  if (asksFullOrBroadList && selectedMap.size < 50) {
    const queryTerms = normalizeForMatch(userText)
      .split(/\s+/)
      .filter(
        (w) =>
          w.length >= 3 &&
          !STOPWORDS_PT.has(w) &&
          ![
            "todas",
            "todos",
            "tudo",
            "lista",
            "listar",
            "liste",
            "completa",
            "completo",
            "minhas",
            "meus",
            "meu",
            "nome",
            "estao",
            "estão",
            "negociacoes",
            "negociacao",
            "cards",
            "card",
            "carteira",
            "quero",
            "ver",
            "mostrar",
            "mostre",
            "mensurar",
            "mensure",
          ].includes(w)
      );

    const candidateDeals =
      queryTerms.length > 0
        ? ctx.knownDeals.filter((d) => {
            const hay = normalizeForMatch(`${d.title} ${d.company || ""} ${d.stageLabel} ${d.contactName || ""}`);
            return queryTerms.some((t) => hay.includes(t));
          })
        : ctx.knownDeals;

    const poolToUse = candidateDeals.length > 0 ? candidateDeals : ctx.knownDeals;
    for (const deal of poolToUse) {
      if (selectedMap.size >= 50) break;
      selectedMap.set(deal.dealId, deal);
    }
  }

  const maxDeals = asksFullOrBroadList ? 50 : asksPluralList ? 15 : 3;
  return Array.from(selectedMap.values()).slice(0, maxDeals);
}

function resolveRelatedCalls(
  suggestedCallDealIds: string[],
  relatedDeals: RelatedDealItem[],
  relatedConversations: RelatedConversationItem[],
  fullReplyText: string,
  userText: string,
  ctx: OperatorContextResult | null
): RelatedCallActionItem[] {
  if (!ctx || isSecrecyOrEmptyRefusalReply(fullReplyText, ctx)) return [];

  // Como todo card em `relatedDeals` já possui telefone + botão de discagem VigosPhone [📞] + botão WhatsApp [💬]
  // embutidos no próprio card unificado, NUNCA criamos um card duplicado em `relatedCalls` para o mesmo contato!
  const coveredDealIds = new Set(relatedDeals.map((d) => d.dealId));
  const coveredConvIds = new Set(relatedDeals.map((d) => d.conversationId).filter(Boolean) as string[]);
  const coveredPhones = new Set(
    relatedDeals
      .map((d) => (d.contactPhone || "").replace(/\D/g, ""))
      .filter((p) => p.length >= 8)
  );
  const coveredNames = new Set(
    relatedDeals
      .flatMap((d) => [d.company, d.contactName, d.title])
      .map((n) => normalizeForMatch(n || ""))
      .filter((n) => n.length >= 3)
  );

  const isAlreadyCoveredByDeal = (item: {
    dealId?: string;
    conversationId?: string;
    phone?: string;
    clientName?: string;
    company?: string;
  }) => {
    if (item.dealId && coveredDealIds.has(item.dealId)) return true;
    if (item.conversationId && coveredConvIds.has(item.conversationId)) return true;
    const digits = (item.phone || "").replace(/\D/g, "");
    if (digits.length >= 8 && coveredPhones.has(digits)) return true;
    const nameKey = normalizeForMatch(item.company || item.clientName || "");
    if (nameKey.length >= 3 && coveredNames.has(nameKey)) return true;
    return false;
  };

  const selectedByPhone = new Map<string, RelatedCallActionItem>();
  const dealsById = new Map(ctx.knownDeals.map((d) => [d.dealId, d]));
  const convsById = new Map(ctx.knownConversations.map((c) => [c.clientId, c]));

  const addCallItem = (item: RelatedCallActionItem) => {
    if (isAlreadyCoveredByDeal(item)) return;
    const digits = (item.phone || "").replace(/\D/g, "");
    if (digits.length < 8) return;
    if (!selectedByPhone.has(digits)) {
      selectedByPhone.set(digits, item);
    }
  };

  const combinedText = `${userText} ${fullReplyText}`;
  const isCallContext =
    /\b(?:ligar|liga[çc][aã]o|liga[çc][oõ]es|ligue|discar|telefone|fone|vigosphone|vigos|contato\s+telef[oô]nico)\b/i.test(
      combinedText
    );
  const asksScheduledCalls =
    /\b(?:liga[çc][aã]o|liga[çc][oõ]es)\b.*\b(?:agendada|agendadas|hoje|pendente|pendentes)\b|\b(?:quem\s+devo\s+ligar|para\s+quem\s+ligar)\b/i.test(
      combinedText
    );

  // 1. Ligações agendadas no dia (quando não estão já representadas em relatedDeals)
  if (asksScheduledCalls && ctx.scheduledCallActions.length > 0) {
    for (const sc of ctx.scheduledCallActions) {
      addCallItem(sc);
    }
  }

  // 2. IDs explicitamente sugeridos em suggestedCallDealIds que NÃO estejam em relatedDeals
  if (isCallContext) {
    for (const rawId of suggestedCallDealIds) {
      const id = (rawId || "").trim();
      const deal = dealsById.get(id);
      if (deal && deal.contactPhone) {
        addCallItem({
          id: `call-deal-${deal.dealId}`,
          clientName: deal.contactName || deal.company || deal.title,
          company: deal.company,
          phone: deal.contactPhone,
          dealId: deal.dealId,
          dealTitle: deal.title,
          dealValueFormatted: deal.valueFormatted,
          stageLabel: deal.stageLabel,
          conversationId: deal.conversationId,
          reason: "Recomendado para ligação de fechamento",
        });
        continue;
      }
      const conv = convsById.get(id);
      if (conv && conv.clientPhone) {
        addCallItem({
          id: `call-conv-${conv.clientId}`,
          clientName: conv.clientName,
          company: conv.company,
          phone: conv.clientPhone,
          conversationId: conv.clientId,
          reason: conv.statusLabel || "Contato direto via VigosPhone",
        });
      }
    }
  }

  // 3. Se o contexto é explicitamente de ligação e citou conversas do WhatsApp sem deal no CRM
  if (isCallContext && selectedByPhone.size === 0 && relatedDeals.length === 0 && relatedConversations.length > 0) {
    for (const conv of relatedConversations.slice(0, 2)) {
      if (conv.clientPhone) {
        addCallItem({
          id: `call-conv-${conv.clientId}`,
          clientName: conv.clientName,
          company: conv.company,
          phone: conv.clientPhone,
          conversationId: conv.clientId,
          reason: conv.statusLabel || "Clique para discar direto no VigosPhone",
        });
      }
    }
  }

  return Array.from(selectedByPhone.values()).slice(0, 2);
}

function resolveRelatedConversations(
  mentionedIds: string[],
  fullReplyText: string,
  userText: string,
  ctx: OperatorContextResult | null,
  relatedDeals: RelatedDealItem[] = [],
  operatorName?: string
): RelatedConversationItem[] {
  if (!ctx || ctx.knownConversations.length === 0) return [];
  if (isSecrecyOrEmptyRefusalReply(fullReplyText, ctx)) return [];

  // Como todo card em `relatedDeals` já inclui o botão de abrir conversa no WhatsApp (`deal.conversationId`),
  // filtramos qualquer conversa que já pertença a um contato presente em `relatedDeals`!
  const coveredConvIds = new Set(relatedDeals.map((d) => d.conversationId).filter(Boolean) as string[]);
  const coveredPhones = new Set(
    relatedDeals
      .map((d) => (d.contactPhone || "").replace(/\D/g, ""))
      .filter((p) => p.length >= 8)
  );
  const coveredNames = new Set(
    relatedDeals
      .flatMap((d) => [d.company, d.contactName, d.title])
      .map((n) => normalizeForMatch(n || ""))
      .filter((n) => n.length >= 3)
  );

  const isCoveredByDeal = (conv: RelatedConversationItem) => {
    if (coveredConvIds.has(conv.clientId)) return true;
    const digits = (conv.clientPhone || "").replace(/\D/g, "");
    if (digits.length >= 8 && coveredPhones.has(digits)) return true;
    const cName = normalizeForMatch(conv.clientName || "");
    const cComp = normalizeForMatch(conv.company || "");
    if ((cName.length >= 3 && coveredNames.has(cName)) || (cComp.length >= 3 && coveredNames.has(cComp))) {
      return true;
    }
    return false;
  };

  const selectedMap = new Map<string, RelatedConversationItem>();
  const byId = new Map(ctx.knownConversations.map((c) => [c.clientId, c]));

  const addConv = (conv: RelatedConversationItem) => {
    if (isCoveredByDeal(conv)) return;
    selectedMap.set(conv.clientId, conv);
  };

  // 1. IDs explicitamente retornados pela IA em mentionedConversationIds
  for (const id of mentionedIds) {
    const found = byId.get(id);
    if (found) addConv(found);
  }

  // 2. Nomes de clientes citados nominalmente no texto da resposta da IA (excluindo o próprio nome do operador)
  const opFullNorm = normalizeForMatch(operatorName || "");
  const opFirstNorm = opFullNorm.split(/\s+/)[0] || "";
  const normReply = normalizeForMatch(fullReplyText);
  const normUser = normalizeForMatch(userText);
  const userExplicitlyTypedOpName =
    Boolean(opFirstNorm && opFirstNorm.length >= 3 && containsWholeNormalizedPhrase(normUser, opFirstNorm));

  for (const conv of ctx.knownConversations) {
    const nameNorm = normalizeForMatch(conv.clientName || "");
    if (nameNorm.length >= 4 && !nameNorm.startsWith("cliente ")) {
      if (!userExplicitlyTypedOpName && (nameNorm === opFirstNorm || nameNorm === opFullNorm)) {
        continue;
      }
      if (containsWholeNormalizedPhrase(normReply, nameNorm)) {
        addConv(conv);
      }
    }
  }

  // 3. Se o operador perguntou explicitamente sobre leads de hoje
  const asksTodayLeads =
    /(?:lead|leads|chegaram|chegou|recebi|entraram|entrou|novos)\b.*\b(?:hoje|dia)\b|\b(?:hoje)\b.*\b(?:lead|leads|chegaram|chegou|atendimento)/i.test(
      normUser
    );
  if (asksTodayLeads && ctx.todayLeadsConversations.length > 0) {
    for (const c of ctx.todayLeadsConversations.slice(0, 3)) {
      addConv(c);
    }
  }

  // 4. Se a pergunta for explicitamente sobre fila/conversas aguardando no WhatsApp
  const isCrmFocused =
    relatedDeals.length > 0 ||
    /\b(?:negocia[çc][aã]o|negocia[çc][oõ]es|crm|card|cards|or[çc]amento|or[çc]amentos|proposta|propostas|pipeline|funil|etapa)\b/i.test(
      `${normUser} ${normReply}`
    );

  const asksWaitingSpecifically =
    /\b(?:aguardando|esperando|sem\s+resposta|atraso|atrasad|sla|sobrecarga)\b/i.test(normUser);

  const asksWhatsAppQueue =
    asksWaitingSpecifically ||
    /\b(?:conversa|conversas|atendimento|atendimentos|fila)\b/i.test(normUser);

  if (!isCrmFocused && asksWhatsAppQueue && selectedMap.size === 0) {
    const pool = asksWaitingSpecifically
      ? ctx.waitingConversations
      : ctx.waitingConversations.length > 0
      ? ctx.waitingConversations
      : ctx.knownConversations;
    for (const c of pool.slice(0, 3)) {
      addConv(c);
    }
  }

  return Array.from(selectedMap.values()).slice(0, 3);
}

// Helper para buscar as conversas ativas atuais do operador (para enriquecer cards de sobrecarga/alerta no GET)
async function fetchActiveConversationsForOperatorCard(
  tenantId: string,
  operatorId: string
): Promise<RelatedConversationItem[]> {
  try {
    const activeRows = await db
      .select({
        convId: conversations.id,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        accountName: crmAccounts.name,
        lastMessageText: conversations.lastMessageText,
        lastClientMsg: conversations.lastClientMessageAt,
        lastOpMsg: conversations.lastOperatorMessageAt,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(crmAccounts, eq(contacts.accountId, crmAccounts.id))
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.operatorId, operatorId),
          eq(conversations.queueState, "meus")
        )
      )
      .orderBy(desc(conversations.updatedAt))
      .limit(12);

    const nowMs = Date.now();
    const items: RelatedConversationItem[] = activeRows.map((c) => {
      const clientMsgMs = c.lastClientMsg ? new Date(c.lastClientMsg).getTime() : 0;
      const opMsgMs = c.lastOpMsg ? new Date(c.lastOpMsg).getTime() : 0;
      const isWaiting = clientMsgMs > 0 && (opMsgMs === 0 || clientMsgMs > opMsgMs);
      const waitMinutes = isWaiting ? Math.max(1, Math.floor((nowMs - clientMsgMs) / 60_000)) : 0;

      return {
        clientId: c.convId,
        clientName: c.contactName || c.contactPhone || "Cliente",
        clientPhone: c.contactPhone || undefined,
        company: c.accountName || undefined,
        waitMinutes: isWaiting ? waitMinutes : undefined,
        lastMessage: c.lastMessageText ? c.lastMessageText.slice(0, 90) : undefined,
        statusLabel: isWaiting ? `Aguardando há ${waitMinutes} min` : "Em atendimento",
      };
    });

    items.sort((a, b) => (b.waitMinutes || 0) - (a.waitMinutes || 0));
    return items.slice(0, 8);
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/api/valentina/messages")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      // ── GET: Carrega histórico de mensagens + alertas proativos (deduplicados e interativos) ──
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        const url = new URL(request.url);
        const reqOperatorId = url.searchParams.get("operatorId");
        const scope = url.searchParams.get("scope") || "operator";
        const rawLimit = Number(url.searchParams.get("limit"));
        const limitVal = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.max(rawLimit, 20), 500) : 100;

        // Operador comum só visualiza as próprias mensagens
        let operatorId = session.operator.id;
        if ((session.operator.role === "admin" || session.operator.role === "supervisor") && reqOperatorId) {
          operatorId = reqOperatorId;
        }

        try {
          const scopeFilter =
            scope === "admin"
              ? sql`${internalMessages.metadata}->>'scope' = 'admin'`
              : sql`(
                  ${internalMessages.metadata}->>'scope' = 'operator'
                  OR (
                    (${internalMessages.metadata}->>'scope' IS NULL OR ${internalMessages.metadata}->>'scope' = 'operator')
                    AND (
                      ${internalMessages.metadata}->>'type' IS NULL
                      OR ${internalMessages.metadata}->>'isChat' = 'true'
                      OR ${internalMessages.metadata}->>'type' IN ('lead_transfer', 'sla_alert', 'no_response', 'operator_overload', 'sentiment_alert')
                    )
                  )
                )`;

          const msgs = await db
            .select()
            .from(internalMessages)
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.operatorId, operatorId),
                scopeFilter
              )
            )
            .orderBy(desc(internalMessages.createdAt))
            .limit(limitVal);

          // Se for o escopo do operador, deduplica spam de notificações (operator_overload e sla_alert repetidos)
          // e enriquece o card de sobrecarga com a lista interativa de conversas + botão de abrir
          if (scope !== "admin") {
            let seenOverload = false;
            const seenSlaByConv = new Set<string>();
            const duplicateIdsToDelete: string[] = [];
            const deduplicatedDesc: typeof msgs = [];

            const activeConvsForCard = await fetchActiveConversationsForOperatorCard(tenantId, operatorId);

            // msgs está ordenado do mais recente para o mais antigo (desc)
            for (const row of msgs) {
              const meta: any =
                typeof row.metadata === "string"
                  ? (() => {
                      try {
                        return JSON.parse(row.metadata);
                      } catch {
                        return {};
                      }
                    })()
                  : row.metadata || {};

              const isBrokenLegacyOperatorReply =
                row.direction === "from_agent" &&
                typeof row.content === "string" &&
                /S[aã]o\s+60\s+negocia[çc][oõ]es\s+no\s+total|todas\s+as\s+60\s+negocia[çc][oõ]es\s+da\s+sua\s+carteira|A\s+lista\s+completa\s+vai\s+ficar\s+gigante\s+aqui\s+no\s+WhatsApp|conjugado,\s*3\s*em\s*1|fita\s+de\s+polipropileno\s+\(PP\)\s+de\s+10\s*mm,\s*13\s*mm|travar\s+com\s+o\s+selo\s+met[aá]lico\s+e\s+cortar\s+a\s+sobra|Fora\s+esse,\s+n[aã]o\s+h[aá]\s+outros\s+campos\s+customizados\s+registrados|Fora\s+isso,\s+n[aã]o\s+h[aá]\s+nenhuma\s+outra\s+nota\s+ou\s+atividade\s+detalhada\s+no\s+hist[oó]rico\s+do\s+card|N[aã]o\s+encontrei\s+o\s+cat[aá]logo\s+t[eé]cnico\s+ou\s+as\s+especifica[çc][oõ]es\s+da\s+APF300-2B/i.test(
                  row.content
                );
              if (isBrokenLegacyOperatorReply) {
                duplicateIdsToDelete.push(row.id);
                continue;
              }

              // Limpa relatedDeals falsos-positivos anexados anteriormente em respostas técnicas de máquinas (ex: "Envasadora - Pamells" e "Dora" na resposta da APF300-2B)
              if (
                row.direction === "from_agent" &&
                Array.isArray(meta?.relatedDeals) &&
                meta.relatedDeals.length > 0 &&
                typeof row.content === "string" &&
                /componentes\s+pneum[aá]ticos\s+da\s+AIRTIC|ciclos\s+por\s+minuto,\s*por\s+bico|Envasadora\s+Autom[aá]tica\s+da\s+linha\s+Personnalite|Puxei\s+as\s+informa[çc][oõ]es\s+do\s+manual\s+dela/i.test(
                  row.content
                )
              ) {
                const { relatedDeals: _rd, relatedConversations: _rc, relatedCalls: _rcl, ...cleanMeta } = meta;
                row.metadata = cleanMeta;
                db.update(internalMessages)
                  .set({ metadata: cleanMeta })
                  .where(and(eq(internalMessages.tenantId, tenantId), eq(internalMessages.id, row.id)))
                  .catch(() => {});
              }

              // Auto-repara mensagens com tag bruta [SEND_IMAGE:/knowledge-media/...] vazada no chat do operador
              if (
                row.direction === "from_agent" &&
                typeof row.content === "string" &&
                /\[SEND_IMAGE:([^\]]+)\]/i.test(row.content)
              ) {
                try {
                  const sendMatch = row.content.match(/\[SEND_IMAGE:([^\]]+)\]/i);
                  const rawMediaUrl = sendMatch ? sendMatch[1].trim() : "";
                  const resolvedByUrl = rawMediaUrl
                    ? await resolveCatalogPhotosByMediaUrls(tenantId, [rawMediaUrl])
                    : [];
                  let photo = resolvedByUrl[0];
                  if (!photo) {
                    const fallbackFromHistory = await resolveMatchingCatalogPhotos(tenantId, {
                      userText: row.content,
                      recentHistoryMessages: msgs.map((m) => String(m.content || "")),
                      isExplicitRequest: true,
                      maxPhotos: 1,
                    });
                    photo = fallbackFromHistory[0];
                  }
                  const kfMatch = rawMediaUrl.match(/(kf-[a-z0-9-]+)/i);
                  const fallbackFileId = kfMatch ? kfMatch[1] : "";
                  const rawImageUrl =
                    photo?.rawImageUrl ||
                    (fallbackFileId
                      ? `/api/valentina/catalog-images?action=rawImage&fileId=${encodeURIComponent(fallbackFileId)}`
                      : rawMediaUrl);
                  const safeFileName = (photo?.fileName || `${fallbackFileId || "equipamento"}.png`).replace(
                    /[:\]]/g,
                    "_"
                  );
                  const remainderText = row.content
                    .replace(/\[SEND_IMAGE:[^\]]+\]/gi, "")
                    .replace(/\b[EÉ]\s+essa\s+que\s+voc[eê]\s+precisa\??/gi, "")
                    .replace(/\bEsse\s+seria\s+o\s+modelo\s+que\s+voc[eê]\s+est[aá]\s+procurando\??/gi, "")
                    .trim();
                  const patchedContent = remainderText
                    ? `[LOCAL_MEDIA:image:${rawImageUrl}:${safeFileName}]\n${remainderText}`
                    : `[LOCAL_MEDIA:image:${rawImageUrl}:${safeFileName}]`;
                  const patchedMeta = {
                    ...meta,
                    catalogPhoto: photo
                      ? {
                          fileId: photo.fileId,
                          fileName: photo.fileName,
                          modelKey: photo.normalizedModelKey,
                          modelDisplay: photo.modelDisplay,
                          aliasKeys: photo.aliasKeys,
                          proactive: false,
                        }
                      : meta?.catalogPhoto,
                  };
                  row.content = patchedContent;
                  row.metadata = patchedMeta;
                  db.update(internalMessages)
                    .set({ content: patchedContent, metadata: patchedMeta })
                    .where(and(eq(internalMessages.tenantId, tenantId), eq(internalMessages.id, row.id)))
                    .catch(() => {});
                } catch {
                  // Ignora falha silenciosa no auto-reparo
                }
              }

              // Limpa pergunta de triagem de lead ("Consigo sim. É essa que você precisa?") em resposta a vendedor interno
              if (
                row.direction === "from_agent" &&
                typeof row.content === "string" &&
                /\bConsigo\s+sim\.\s*[EÉ]\s+essa\s+que\s+voc[eê]\s+precisa\??/i.test(row.content)
              ) {
                const patchedContent = row.content
                  .replace(
                    /\bConsigo\s+sim\.\s*[EÉ]\s+essa\s+que\s+voc[eê]\s+precisa\??/i,
                    "Consigo sim, segue a foto oficial do equipamento."
                  )
                  .trim();
                row.content = patchedContent;
                db.update(internalMessages)
                  .set({ content: patchedContent })
                  .where(and(eq(internalMessages.tenantId, tenantId), eq(internalMessages.id, row.id)))
                  .catch(() => {});
              }

              // 1. Remove foto indevidamente anexada em balão puramente introdutório de galeria ("Certo, vou te mandar as fotos de todos os modelos da linha...")
              if (
                row.direction === "from_agent" &&
                typeof row.content === "string" &&
                /^\[LOCAL_MEDIA:image:[^\]]+\]\s*\n?/i.test(row.content) &&
                /\bvou\s+te\s+mandar\s+as\s+fotos\s+de\s+todos\s+os\s+modelos\s+da\s+linha\b/i.test(
                  row.content
                )
              ) {
                const strippedIntro = row.content.replace(/^\[LOCAL_MEDIA:image:[^\]]+\]\s*\n?/i, "").trim();
                const { catalogPhoto: _cp, ...restMeta } = meta;
                row.content = strippedIntro;
                row.metadata = restMeta;
                db.update(internalMessages)
                  .set({ content: strippedIntro, metadata: restMeta })
                  .where(and(eq(internalMessages.tenantId, tenantId), eq(internalMessages.id, row.id)))
                  .catch(() => {});
              }

              // 2. Desduplica foto repetida em dois balões do mesmo turno (ex: 1º e 2º balão da Pratic Seal com a mesma imagem)
              if (
                row.direction === "from_agent" &&
                typeof row.content === "string" &&
                /^\[LOCAL_MEDIA:image:([^\]]+)\]\s*\n/i.test(row.content)
              ) {
                const mediaTagMatch = row.content.match(/^(\[LOCAL_MEDIA:image:[^\]]+\])\s*\n/i);
                const mediaTag = mediaTagMatch ? mediaTagMatch[1] : "";
                const rowCreatedMs = row.createdAt ? new Date(row.createdAt).getTime() : 0;
                if (mediaTag && rowCreatedMs > 0) {
                  const hasEarlierBubbleWithSameMediaInTurn = msgs.some((other) => {
                    if (other.id === row.id || other.direction !== "from_agent") return false;
                    if (typeof other.content !== "string" || !other.content.startsWith(mediaTag)) return false;
                    const otherMs = other.createdAt ? new Date(other.createdAt).getTime() : 0;
                    return otherMs > 0 && otherMs < rowCreatedMs && rowCreatedMs - otherMs <= 25_000;
                  });
                  if (hasEarlierBubbleWithSameMediaInTurn) {
                    const cleanedSecondBubble = row.content
                      .replace(/^\[LOCAL_MEDIA:image:[^\]]+\]\s*\n?/i, "")
                      .trim();
                    const { catalogPhoto: _cp, ...restMeta } = meta;
                    row.content = cleanedSecondBubble;
                    row.metadata = restMeta;
                    db.update(internalMessages)
                      .set({ content: cleanedSecondBubble, metadata: restMeta })
                      .where(and(eq(internalMessages.tenantId, tenantId), eq(internalMessages.id, row.id)))
                      .catch(() => {});
                  }
                }
              }

              // 3. Auto-expande e anexa fotos em balão que agrupou múltiplos modelos da galeria separados por quebra dupla
              if (
                row.direction === "from_agent" &&
                typeof row.content === "string" &&
                !/^\[LOCAL_MEDIA:image:/i.test(row.content.trim())
              ) {
                const subParagraphs = row.content
                  .split(/\n{2,}/)
                  .map((p) => p.trim())
                  .filter(Boolean);
                const modelCaptionCount = subParagraphs.filter((p) =>
                  /^(?:Essa\s+[eé]\s+a|Aqui\s+a|Este\s+[eé]\s+o|Temos\s+tamb[eé]m|E\s+por\s+fim,\s+a)\s+/i.test(
                    p
                  )
                ).length;

                if (subParagraphs.length >= 2 && modelCaptionCount >= 2) {
                  try {
                    const baseCreatedMs = row.createdAt ? new Date(row.createdAt).getTime() : Date.now();
                    const expandedRowsChronological: typeof msgs = [];
                    for (let pIdx = 0; pIdx < subParagraphs.length; pIdx++) {
                      const pText = subParagraphs[pIdx];
                      const matchedForPart = await resolveMatchingCatalogPhotos(tenantId, {
                        userText: pText,
                        isExplicitRequest: true,
                        maxPhotos: 1,
                      });
                      const partPhoto = matchedForPart[0];
                      const partSafeFile = partPhoto ? partPhoto.fileName.replace(/[:\]]/g, "_") : "";
                      const partContent = partPhoto
                        ? `[LOCAL_MEDIA:image:${partPhoto.rawImageUrl}:${partSafeFile}]\n${pText}`
                        : pText;
                      const partMeta = {
                        ...meta,
                        ...(pIdx > 0 ? { thoughtTrace: undefined } : {}),
                        catalogPhoto: partPhoto
                          ? {
                              fileId: partPhoto.fileId,
                              fileName: partPhoto.fileName,
                              modelKey: partPhoto.normalizedModelKey,
                              modelDisplay: partPhoto.modelDisplay,
                              internalCode: partPhoto.internalCode,
                              aliasKeys: partPhoto.aliasKeys,
                              proactive: false,
                            }
                          : undefined,
                      };
                      if (pIdx === 0) {
                        row.content = partContent;
                        row.metadata = partMeta;
                        db.update(internalMessages)
                          .set({ content: partContent, metadata: partMeta })
                          .where(and(eq(internalMessages.tenantId, tenantId), eq(internalMessages.id, row.id)))
                          .catch(() => {});
                        expandedRowsChronological.push(row);
                      } else {
                        const newPartId = `${row.id}-p${pIdx}`;
                        const newPartCreatedAt = new Date(baseCreatedMs + pIdx * 120);
                        const newPartRow = {
                          ...row,
                          id: newPartId,
                          content: partContent,
                          metadata: partMeta,
                          createdAt: newPartCreatedAt,
                        };
                        db.insert(internalMessages)
                          .values({
                            id: newPartId,
                            tenantId,
                            operatorId: row.operatorId,
                            direction: "from_agent",
                            agentType: row.agentType || "supervisor",
                            content: partContent,
                            metadata: partMeta,
                            read: row.read ?? 1,
                            createdAt: newPartCreatedAt,
                          })
                          .onConflictDoNothing()
                          .catch(() => {});
                        expandedRowsChronological.push(newPartRow);
                      }
                    }
                    // Como deduplicatedDesc está em ordem decrescente (mais recente primeiro), empilha do último parágrafo para o primeiro
                    for (let k = expandedRowsChronological.length - 1; k >= 0; k--) {
                      deduplicatedDesc.push(expandedRowsChronological[k]);
                    }
                    continue;
                  } catch {
                    // Se falhar, segue fluxo normal
                  }
                }
              }

              // 4. Auto-repara mensagens em que o agente confirmou o envio da foto ou apresentou um modelo sem a imagem anexada
              if (
                row.direction === "from_agent" &&
                typeof row.content === "string" &&
                !/^\[LOCAL_MEDIA:image:/i.test(row.content.trim()) &&
                !/\bvou\s+te\s+mandar\s+as\s+fotos\s+de\s+todos\s+os\s+modelos\b/i.test(row.content) &&
                (/\bsegue\s+(?:a[ií]\s+)?a\s+foto\s+d[ao]\s+([A-Za-z0-9-]+)/i.test(row.content) ||
                  /^(?:Essa\s+[eé]\s+a|Aqui\s+a|Este\s+[eé]\s+o|E\s+por\s+fim,\s+a)\s+\*\*?[A-Za-z0-9\s-]+[^:\n]*:\s*$/i.test(
                    row.content.trim()
                  ) ||
                  /^A\s+Pratic\s+Seal\s+[eé]\s+a\s+nossa\s+Seladora\s+Port[aá]til\s+TC-20/i.test(
                    row.content.trim()
                  ))
              ) {
                const rowCreatedMs = row.createdAt ? new Date(row.createdAt).getTime() : 0;
                const isPraticSealIntro = /^A\s+Pratic\s+Seal\s+[eé]\s+a\s+nossa\s+Seladora/i.test(
                  row.content.trim()
                );
                const siblingAlreadyHasMedia =
                  isPraticSealIntro &&
                  rowCreatedMs > 0 &&
                  msgs.some((other) => {
                    if (other.id === row.id || other.direction !== "from_agent") return false;
                    if (typeof other.content !== "string" || !other.content.startsWith("[LOCAL_MEDIA:image:")) {
                      return false;
                    }
                    const otherMs = other.createdAt ? new Date(other.createdAt).getTime() : 0;
                    return otherMs > 0 && Math.abs(otherMs - rowCreatedMs) <= 25_000;
                  });

                if (!siblingAlreadyHasMedia) {
                  try {
                    const matchedPhotos = await resolveMatchingCatalogPhotos(tenantId, {
                      userText: row.content,
                      isExplicitRequest: true,
                      maxPhotos: 1,
                    });
                    if (matchedPhotos.length > 0) {
                      const photo = matchedPhotos[0];
                      const safeFileName = photo.fileName.replace(/[:\]]/g, "_");
                      const patchedContent = `[LOCAL_MEDIA:image:${photo.rawImageUrl}:${safeFileName}]\n${row.content.trim()}`;
                      const patchedMeta = {
                        ...meta,
                        catalogPhoto: {
                          fileId: photo.fileId,
                          fileName: photo.fileName,
                          modelKey: photo.normalizedModelKey,
                          modelDisplay: photo.modelDisplay,
                          internalCode: photo.internalCode,
                          aliasKeys: photo.aliasKeys,
                          proactive: !/\bsegue\s+(?:a[ií]\s+)?a\s+foto/i.test(row.content),
                        },
                      };
                      row.content = patchedContent;
                      row.metadata = patchedMeta;
                      db.update(internalMessages)
                        .set({ content: patchedContent, metadata: patchedMeta })
                        .where(and(eq(internalMessages.tenantId, tenantId), eq(internalMessages.id, row.id)))
                        .catch(() => {});
                    }
                  } catch {
                    // Ignora falha silenciosa no auto-reparo
                  }
                }
              }

              const isOverload =
                meta?.type === "operator_overload" ||
                meta?.warningType === "overload" ||
                (typeof row.content === "string" &&
                  row.content.includes("conversas ativas neste momento"));

              if (isOverload) {
                if (seenOverload) {
                  // Duplicata antiga de sobrecarga -> remove do histórico e agenda limpeza no banco
                  duplicateIdsToDelete.push(row.id);
                  continue;
                }
                seenOverload = true;
                // Enriquece o único card de sobrecarga mantido com as conversas interativas
                const existingConvs = Array.isArray(meta?.conversations) ? meta.conversations : [];
                const enrichedMeta = {
                  ...meta,
                  type: "operator_overload",
                  warningType: "overload",
                  conversations: existingConvs.length > 0 ? existingConvs : activeConvsForCard,
                };
                row.metadata = enrichedMeta;
                deduplicatedDesc.push(row);
                continue;
              }

              const isSlaOrDelay = meta?.type === "sla_alert" || meta?.type === "no_response";
              if (isSlaOrDelay) {
                const convKey = meta?.conversationId || meta?.clientId || meta?.clientName || "";
                if (convKey) {
                  if (seenSlaByConv.has(convKey)) {
                    duplicateIdsToDelete.push(row.id);
                    continue;
                  }
                  seenSlaByConv.add(convKey);
                }
              }

              deduplicatedDesc.push(row);
            }

            // Limpa do banco em background os alertas duplicados antigos para nunca mais voltarem
            if (duplicateIdsToDelete.length > 0) {
              db.delete(internalMessages)
                .where(
                  and(
                    eq(internalMessages.tenantId, tenantId),
                    inArray(internalMessages.id, duplicateIdsToDelete)
                  )
                )
                .catch((err) =>
                  console.warn("[valentina/messages] Falha ao limpar duplicatas antigas:", err?.message)
                );
            }

            const sortedChronological = deduplicatedDesc
              .reverse()
              .sort((a, b) => {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return ta - tb;
              });

            // ── Auto-reparo definitivo de mensagens do operador gravadas como "[object Object]" ──
            const parseMetaObj = (rawMeta: unknown): Record<string, any> => {
              if (!rawMeta) return {};
              if (typeof rawMeta === "string") {
                try {
                  const p = JSON.parse(rawMeta);
                  return p && typeof p === "object" ? p : {};
                } catch {
                  return {};
                }
              }
              return typeof rawMeta === "object" ? (rawMeta as Record<string, any>) : {};
            };

            const extractRecoveredUserQuery = (agentRow: (typeof sortedChronological)[number]): string | null => {
              const m = parseMetaObj(agentRow.metadata);
              if (
                typeof m.userQuery === "string" &&
                m.userQuery.trim() &&
                !m.userQuery.includes("[object Object]")
              ) {
                return m.userQuery.trim();
              }
              const steps: any[] = Array.isArray(m?.thoughtTrace?.steps) ? m.thoughtTrace.steps : [];
              for (const st of steps) {
                const dt = typeof st?.detailText === "string" ? st.detailText : "";
                if (!dt) continue;
                const matchAnalyze = dt.match(/Analisando\s+"([\s\S]+?)"\s+para\s+consultar/i);
                if (matchAnalyze?.[1]?.trim() && !matchAnalyze[1].includes("[object Object]")) {
                  return matchAnalyze[1].trim();
                }
                const matchCasual = dt.match(/Mensagem\s+casual\s+reconhecida\s+\("([\s\S]+?)"\)/i);
                if (matchCasual?.[1]?.trim() && !matchCasual[1].includes("[object Object]")) {
                  return matchCasual[1].trim();
                }
                const matchInit = dt.match(/Iniciando\s+processamento\s+real\s+de\s+"([\s\S]+?)"/i);
                if (matchInit?.[1]?.trim() && !matchInit[1].includes("[object Object]")) {
                  return matchInit[1].trim();
                }
              }
              return null;
            };

            const repairedUpdates: Array<{ id: string; content: string }> = [];
            const orphanObjectRowIds = new Set<string>();

            let idx = 0;
            while (idx < sortedChronological.length) {
              const row = sortedChronological[idx];
              if (row.direction !== "to_agent") {
                idx++;
                continue;
              }

              // Coleta sequência contígua de mensagens to_agent antes da próxima resposta from_agent
              let runEnd = idx;
              while (
                runEnd < sortedChronological.length &&
                sortedChronological[runEnd].direction === "to_agent"
              ) {
                runEnd++;
              }

              const runRows = sortedChronological.slice(idx, runEnd);
              const brokenTextRunRows: typeof runRows = [];

              for (const r of runRows) {
                const rawTxt = typeof r.content === "string" ? r.content.trim() : "";
                if (!rawTxt.includes("[object Object]") && rawTxt.length > 0) {
                  continue;
                }
                const rMeta = parseMetaObj(r.metadata);
                const hasAttachment = Boolean(
                  rMeta?.attachedImageInfo?.dataUrl || rMeta?.attachedFileInfo?.name
                );
                if (hasAttachment) {
                  const cleanedCaption = rawTxt.replace(/\[object Object\]/gi, "").trim();
                  const fallbackLabel = `[Arquivo anexado: ${
                    rMeta?.attachedImageInfo?.name || rMeta?.attachedFileInfo?.name || "Imagem.jpg"
                  }]`;
                  const repairedText = cleanedCaption || fallbackLabel;
                  r.content = repairedText;
                  repairedUpdates.push({ id: r.id, content: repairedText });
                } else {
                  brokenTextRunRows.push(r);
                }
              }

              if (brokenTextRunRows.length > 0) {
                // Procura na resposta from_agent imediatamente seguinte o texto original em thoughtTrace
                let recoveredQuery: string | null = null;
                let lookIdx = runEnd;
                while (
                  lookIdx < sortedChronological.length &&
                  sortedChronological[lookIdx].direction === "from_agent"
                ) {
                  recoveredQuery = extractRecoveredUserQuery(sortedChronological[lookIdx]);
                  if (recoveredQuery) break;
                  lookIdx++;
                }

                const recoveredLines = recoveredQuery
                  ? recoveredQuery
                      .split(/\n+/)
                      .map((l) => l.trim())
                      .filter((l) => l.length > 0 && !l.includes("[object Object]"))
                  : [];

                if (recoveredLines.length > 0) {
                  if (brokenTextRunRows.length <= recoveredLines.length) {
                    for (let b = 0; b < brokenTextRunRows.length; b++) {
                      const textForRow =
                        b === brokenTextRunRows.length - 1
                          ? recoveredLines.slice(b).join("\n")
                          : recoveredLines[b];
                      brokenTextRunRows[b].content = textForRow;
                      repairedUpdates.push({ id: brokenTextRunRows[b].id, content: textForRow });
                    }
                  } else {
                    // Mais linhas [object Object] do que mensagens no turno (ex: tentativas órfãs anteriores):
                    // preserva e restaura as últimas N (imediatamente antes da resposta) e remove as órfãs
                    const orphanCount = brokenTextRunRows.length - recoveredLines.length;
                    for (let b = 0; b < orphanCount; b++) {
                      orphanObjectRowIds.add(brokenTextRunRows[b].id);
                      duplicateIdsToDelete.push(brokenTextRunRows[b].id);
                    }
                    for (let b = 0; b < recoveredLines.length; b++) {
                      const targetRow = brokenTextRunRows[orphanCount + b];
                      const textForRow = recoveredLines[b];
                      targetRow.content = textForRow;
                      repairedUpdates.push({ id: targetRow.id, content: textForRow });
                    }
                  }
                } else {
                  // Sem resposta correspondente ou sem texto recuperável -> remove bolhas [object Object] órfãs
                  for (const br of brokenTextRunRows) {
                    orphanObjectRowIds.add(br.id);
                    duplicateIdsToDelete.push(br.id);
                  }
                }
              }

              idx = runEnd;
            }

            if (repairedUpdates.length > 0) {
              Promise.all(
                repairedUpdates.map((u) =>
                  db
                    .update(internalMessages)
                    .set({ content: u.content })
                    .where(
                      and(
                        eq(internalMessages.tenantId, tenantId),
                        eq(internalMessages.id, u.id)
                      )
                    )
                )
              ).catch((err) =>
                console.warn("[valentina/messages] Falha ao persistir auto-reparo de mensagens:", err?.message)
              );
            }

            // Limpa do banco em background os alertas duplicados e bolhas [object Object] órfãs para nunca mais voltarem
            if (duplicateIdsToDelete.length > 0) {
              db.delete(internalMessages)
                .where(
                  and(
                    eq(internalMessages.tenantId, tenantId),
                    inArray(internalMessages.id, duplicateIdsToDelete)
                  )
                )
                .catch((err) =>
                  console.warn("[valentina/messages] Falha ao limpar duplicatas antigas:", err?.message)
                );
            }

            const finalSorted = sortedChronological.filter((r) => !orphanObjectRowIds.has(r.id));
            let lastSeenUserQuery = "";
            const metaRepairs: Array<{ id: string; metadata: Record<string, any> }> = [];
            for (const row of finalSorted) {
              if (row.direction === "to_agent") {
                if (typeof row.content === "string" && row.content.trim()) {
                  lastSeenUserQuery = row.content.trim();
                }
                continue;
              }
              const rMeta = parseMetaObj(row.metadata);
              if (
                rMeta.type === "sla_alert" ||
                rMeta.type === "no_response" ||
                rMeta.type === "operator_overload" ||
                rMeta.type === "new_lead"
              ) {
                continue;
              }

              const effectiveUserQuery = rMeta.userQuery || lastSeenUserQuery;
              let metaChanged = false;
              const nextMeta: Record<string, any> = { ...rMeta };

              // Auto-reparo: se a resposta afirma explicitamente que não há nenhum cliente aguardando / caixa em dia, limpa cards vazados
              if (
                isSecrecyOrEmptyRefusalReply(row.content || "", null) &&
                ((Array.isArray(nextMeta.relatedDeals) && nextMeta.relatedDeals.length > 0) ||
                  (Array.isArray(nextMeta.relatedConversations) && nextMeta.relatedConversations.length > 0) ||
                  (Array.isArray(nextMeta.relatedCalls) && nextMeta.relatedCalls.length > 0))
              ) {
                delete nextMeta.relatedDeals;
                delete nextMeta.relatedConversations;
                delete nextMeta.relatedCalls;
                metaChanged = true;
              }

              const hasStoredManualOrCatalog =
                Array.isArray(nextMeta.knowledgeSources) &&
                nextMeta.knowledgeSources.some(
                  (s: any) => s?.kind === "manual" || s?.kind === "document" || s?.kind === "catalog"
                );

              if (!Array.isArray(nextMeta.knowledgeSources) || !nextMeta.knowledgeSourceStatus || hasStoredManualOrCatalog) {
                const resolvedSources = await resolveKnowledgeSourcesForMessage({
                  tenantId,
                  userQuery: effectiveUserQuery,
                  aiReplyText: row.content || "",
                  catalogPhoto: nextMeta.catalogPhoto || null,
                  hasCrmContext: Boolean(
                    (Array.isArray(nextMeta.relatedConversations) && nextMeta.relatedConversations.length > 0) ||
                      (Array.isArray(nextMeta.relatedDeals) && nextMeta.relatedDeals.length > 0) ||
                      (Array.isArray(nextMeta.relatedCalls) && nextMeta.relatedCalls.length > 0)
                  ),
                });
                if (
                  !Array.isArray(nextMeta.knowledgeSources) ||
                  nextMeta.knowledgeSourceStatus !== resolvedSources.status ||
                  nextMeta.knowledgeSources.length !== resolvedSources.sources.length
                ) {
                  nextMeta.knowledgeSources = resolvedSources.sources;
                  nextMeta.knowledgeSourceStatus = resolvedSources.status;
                  nextMeta.knowledgeSourceStatusLabel = resolvedSources.statusLabel;
                  nextMeta.knowledgeSourceStatusDescription = resolvedSources.statusDescription;
                  metaChanged = true;
                }
              }

              if (metaChanged) {
                row.metadata = nextMeta;
                metaRepairs.push({ id: row.id, metadata: nextMeta });
              }
            }

            if (metaRepairs.length > 0) {
              Promise.all(
                metaRepairs.map((u) =>
                  db
                    .update(internalMessages)
                    .set({ metadata: u.metadata })
                    .where(and(eq(internalMessages.tenantId, tenantId), eq(internalMessages.id, u.id)))
                )
              ).catch(() => {});
            }

            return new Response(JSON.stringify(finalSorted), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const isBrokenAdminMessage = (txt: string) =>
            /n[aã]o\s+(?:tenho|possuo)\s+acesso|n[aã]o\s+est[aã]o\s+dispon[ií]veis\s+no\s+contexto|n[aã]o\s+consigo\s+consultar\s+o\s+tempo\s+m[eé]dio|falha\s+no\s+in[ií]cio\s+do\s+ciclo|Erro\s+na\s+compila[cç][aã]o\s+da\s+m[eé]trica|Mec[aâ]nica\s+Souza\s+Ltda|Construtora\s+Alfa|^\[object Object\]$/i.test(
              (txt || "").trim()
            );

          const brokenAdminIds = msgs
            .filter(
              (m) =>
                (m.direction === "from_agent" && isBrokenAdminMessage(m.content || "")) ||
                (m.direction === "to_agent" && (m.content || "").trim() === "[object Object]")
            )
            .map((m) => m.id);

          if (brokenAdminIds.length > 0) {
            db.delete(internalMessages)
              .where(
                and(
                  eq(internalMessages.tenantId, tenantId),
                  inArray(internalMessages.id, brokenAdminIds)
                )
              )
              .catch(() => {});
          }

          const sorted = msgs
            .filter(
              (m) =>
                !(m.direction === "from_agent" && isBrokenAdminMessage(m.content || "")) &&
                !(m.direction === "to_agent" && (m.content || "").trim() === "[object Object]")
            )
            .reverse()
            .sort((a, b) => {
              const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return ta - tb;
            });

          let lastAdminUserQuery = "";
          for (const row of sorted) {
            if (row.direction === "to_agent") {
              if (typeof row.content === "string" && row.content.trim()) {
                lastAdminUserQuery = row.content.trim();
              }
              continue;
            }
            const rMeta =
              row.metadata && typeof row.metadata === "object"
                ? (row.metadata as Record<string, any>)
                : typeof row.metadata === "string"
                  ? (() => {
                      try {
                        return JSON.parse(row.metadata);
                      } catch {
                        return {};
                      }
                    })()
                  : {};
            const hasStoredManualOrCatalog =
              Array.isArray(rMeta.knowledgeSources) &&
              rMeta.knowledgeSources.some(
                (s: any) => s?.kind === "manual" || s?.kind === "document" || s?.kind === "catalog"
              );
            if (!Array.isArray(rMeta.knowledgeSources) || !rMeta.knowledgeSourceStatus || hasStoredManualOrCatalog) {
              const resolvedSources = await resolveKnowledgeSourcesForMessage({
                tenantId,
                userQuery: rMeta.userQuery || lastAdminUserQuery,
                aiReplyText: row.content || "",
                catalogPhoto: rMeta.catalogPhoto || null,
                hasCrmContext: Boolean(Array.isArray(rMeta.blocks) && rMeta.blocks.length > 0),
              });
              row.metadata = {
                ...rMeta,
                knowledgeSources: resolvedSources.sources,
                knowledgeSourceStatus: resolvedSources.status,
                knowledgeSourceStatusLabel: resolvedSources.statusLabel,
                knowledgeSourceStatusDescription: resolvedSources.statusDescription,
              };
            }
          }

          return new Response(JSON.stringify(sorted), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },

      // ── POST: Envia mensagem e obtém resposta da IA ────────────────────────
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const operatorId = session.operator.id;

        try {
          const body = await request.json();
          const {
            action,
            content,
            batchedUserMessages,
            scope = "operator",
            attachment,
            imageBase64,
            imageFileName,
            knowledgeBase,
            threadHistory,
          } = body;

          // ── Ação de Reset do Chat (arquiva mensagens do ciclo atual para "anteriores", sem excluir) ──
          if (action === "reset") {
            const resetNow = new Date();
            const resetIso = resetNow.toISOString();
            const brtTodayYmdReset = resetNow.toLocaleDateString("en-CA", {
              timeZone: "America/Sao_Paulo",
            });
            const todayStartReset = new Date(`${brtTodayYmdReset}T00:00:00-03:00`);
            const targetScope = scope || "operator";

            await db
              .update(internalMessages)
              .set({
                metadata: sql`COALESCE(${internalMessages.metadata}, '{}'::jsonb) || ${JSON.stringify(
                  {
                    archivedByReset: true,
                    archivedAt: resetIso,
                  }
                )}::jsonb`,
              })
              .where(
                and(
                  eq(internalMessages.tenantId, tenantId),
                  eq(internalMessages.operatorId, operatorId),
                  gte(internalMessages.createdAt, todayStartReset),
                  sql`(${internalMessages.metadata}->>'scope' = ${targetScope} OR (${targetScope} = 'operator' AND (${internalMessages.metadata}->>'isChat' = 'true' OR ${internalMessages.metadata}->>'type' IN ('lead_transfer', 'sla_alert', 'operator_overload', 'no_response'))))`
                )
              );

            return new Response(
              JSON.stringify({ ok: true, resetAt: resetIso }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!content && !attachment && !imageBase64) {
            return new Response(
              JSON.stringify({ error: "content, attachment ou imageBase64 são obrigatórios" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Se um anexo for imagem (.jpg/.jpeg/.png/.webp/.gif ou image/*) e imageBase64 não veio separado, promove automaticamente para imageBase64
          const isAttachmentImage = Boolean(
            attachment?.base64 &&
              ((typeof attachment.mimeType === "string" && attachment.mimeType.startsWith("image/")) ||
                (typeof attachment.name === "string" && /\.(?:jpg|jpeg|png|webp|gif|bmp)$/i.test(attachment.name)))
          );
          const effectiveImageBase64: string | undefined =
            typeof imageBase64 === "string" && imageBase64.trim()
              ? imageBase64.trim()
              : isAttachmentImage
              ? attachment.base64.startsWith("data:")
                ? attachment.base64
                : `data:${attachment.mimeType || "image/jpeg"};base64,${attachment.base64}`
              : undefined;
          const effectiveImageFileName: string | undefined =
            (typeof imageFileName === "string" && imageFileName.trim()) ||
            (isAttachmentImage && typeof attachment?.name === "string" ? attachment.name : undefined) ||
            (typeof content === "string"
              ? content.match(/\[Arquivo\s+(?:anexado|enviado):\s*([^\]]+)\]/i)?.[1]?.trim()
              : undefined);
          const effectiveAttachment = isAttachmentImage ? undefined : attachment;
          const hasAttachedImage = Boolean(effectiveImageBase64);

          // ── Detecta se é Supervisora/Diretoria ou Copiloto do Vendedor ─────
          // scope "admin" → Diretoria / Supervisora (Módulo IA Gestão)
          // scope "operator" → Copiloto Comercial (Módulo Chat, todos os operadores/vendedores)
          const isSupervisor = scope === "admin";
          const sessionPerms = (session as any).permissions;
          const isActuallyAdmin =
            session.operator.role === "admin" ||
            session.operator.role === "supervisor" ||
            sessionPerms?.views?.valentina === true ||
            sessionPerms?.views?.commercialBi === true ||
            sessionPerms?.views?.gestao === true;
          const useManagerContext = isSupervisor && isActuallyAdmin;

          const now = new Date();
          const brtTodayYmd = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
          const todayStart = new Date(`${brtTodayYmd}T00:00:00-03:00`);
          const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
          const brtYesterdayYmd = yesterdayStart.toLocaleDateString("en-CA", {
            timeZone: "America/Sao_Paulo",
          });

          const formatHistoryTimeTag = (rawDate: Date | string | null | undefined): string => {
            if (!rawDate) return "";
            const d = new Date(rawDate);
            if (isNaN(d.getTime())) return "";
            const ymd = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
            const hm = d.toLocaleTimeString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              hour: "2-digit",
              minute: "2-digit",
            });
            if (ymd === brtTodayYmd) return `[Hoje ${hm}] `;
            if (ymd === brtYesterdayYmd) {
              const dm = d.toLocaleDateString("pt-BR", {
                timeZone: "America/Sao_Paulo",
                day: "2-digit",
                month: "2-digit",
              });
              return `[Ontem ${dm} ${hm}] `;
            }
            const dmy = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
            return `[${dmy} ${hm}] `;
          };

          const persona = getAiPersona(tenantId);
          const operatorName = session.operator.name || await getOperatorName(operatorId);
          const operatorEmail = (session.operator as any).email || null;
          const contextTenantId = tenantId;
          const rawContentString =
            typeof content === "string" && content.trim() !== "[object Object]" ? content.trim() : "";
          const rawContentTrimmed = stripAttachmentTagsFromQuery(rawContentString);
          const userText =
            rawContentTrimmed ||
            (hasAttachedImage
              ? `Analise visualmente a foto enviada${effectiveImageFileName ? ` (${effectiveImageFileName})` : ""} e me dê os detalhes do que aparece nela.`
              : `[Arquivo enviado: ${effectiveAttachment?.name ?? "documento"}]`);

          // ── Busca histórico recente da conversa antes de inserir a nova ─────
          const recentChatRows = await db
            .select({
              id: internalMessages.id,
              direction: internalMessages.direction,
              content: internalMessages.content,
              createdAt: internalMessages.createdAt,
              metadata: internalMessages.metadata,
            })
            .from(internalMessages)
            .where(
              and(
                eq(internalMessages.tenantId, tenantId),
                eq(internalMessages.operatorId, operatorId),
                sql`(${internalMessages.metadata}->>'scope' = ${scope} OR (${scope} = 'operator' AND (${internalMessages.metadata}->>'isChat' = 'true' OR ${internalMessages.metadata}->>'type' IN ('lead_transfer', 'sla_alert'))))`
              )
            )
            .orderBy(desc(internalMessages.createdAt))
            .limit(45);

          const parseRowMeta = (rawMeta: unknown): Record<string, any> => {
            if (!rawMeta) return {};
            if (typeof rawMeta === "string") {
              try {
                const parsed = JSON.parse(rawMeta);
                return parsed && typeof parsed === "object" ? parsed : {};
              } catch {
                return {};
              }
            }
            return typeof rawMeta === "object" ? (rawMeta as Record<string, any>) : {};
          };

          // Filtra apenas mensagens do ciclo ativo (ignorando as que foram arquivadas via botão de Reset)
          const activeSessionChatRows = recentChatRows.filter((r) => {
            const meta = parseRowMeta(r.metadata);
            return meta?.archivedByReset !== true;
          });

          // Verifica se o operador já conversou com a IA no ciclo ativo de hoje (para não cumprimentar toda hora!)
          const alreadyTalkingToday = activeSessionChatRows.some((r) => {
            const meta = parseRowMeta(r.metadata);
            const isChatMsg = r.direction === "to_agent" || meta?.isChat === true;
            const createdMs = r.createdAt ? new Date(r.createdAt).getTime() : 0;
            return isChatMsg && createdMs >= todayStart.getTime();
          });

          // Janela de 24h ativa do Fagner/Valentina: reinicia na virada do ciclo diário (todayStart), em Reset manual ou após 24h corridas
          const active24hWindowStartMs = Math.max(
            todayStart.getTime(),
            now.getTime() - 24 * 60 * 60 * 1000
          );
          const alreadySentPhotoKeysInWindow = new Set<string>();
          for (const r of activeSessionChatRows) {
            if (r.direction !== "from_agent") continue;
            const createdMs = r.createdAt ? new Date(r.createdAt).getTime() : 0;
            if (createdMs < active24hWindowStartMs) continue;
            const meta = parseRowMeta(r.metadata);
            if (meta?.catalogPhoto) {
              if (typeof meta.catalogPhoto.fileId === "string" && meta.catalogPhoto.fileId) {
                alreadySentPhotoKeysInWindow.add(meta.catalogPhoto.fileId.toLowerCase());
              }
              if (typeof meta.catalogPhoto.modelKey === "string" && meta.catalogPhoto.modelKey) {
                alreadySentPhotoKeysInWindow.add(meta.catalogPhoto.modelKey.toLowerCase());
              }
              if (Array.isArray(meta.catalogPhoto.aliasKeys)) {
                for (const ak of meta.catalogPhoto.aliasKeys) {
                  if (typeof ak === "string" && ak) alreadySentPhotoKeysInWindow.add(ak.toLowerCase());
                }
              }
            }
            if (Array.isArray(meta?.catalogPhotos)) {
              for (const cp of meta.catalogPhotos) {
                if (typeof cp?.fileId === "string" && cp.fileId) {
                  alreadySentPhotoKeysInWindow.add(cp.fileId.toLowerCase());
                }
                if (typeof cp?.modelKey === "string" && cp.modelKey) {
                  alreadySentPhotoKeysInWindow.add(cp.modelKey.toLowerCase());
                }
                if (Array.isArray(cp?.aliasKeys)) {
                  for (const ak of cp.aliasKeys) {
                    if (typeof ak === "string" && ak) alreadySentPhotoKeysInWindow.add(ak.toLowerCase());
                  }
                }
              }
            }
            const rawContent = typeof r.content === "string" ? r.content : "";
            const localImgMatch = rawContent.match(
              /\[LOCAL_MEDIA:image:[^\]]*fileId=([^:&\]\s]+)[^\]]*:([^\]]+)\]/i
            );
            if (localImgMatch) {
              alreadySentPhotoKeysInWindow.add(localImgMatch[1].toLowerCase());
            }
          }
          if (useManagerContext && Array.isArray(threadHistory)) {
            for (const m of threadHistory) {
              if (!m || m.sender === "operator" || typeof m.content !== "string") continue;
              const msgTimeMs =
                m.createdAt || m.timestamp || m.sentAtISO
                  ? new Date(m.createdAt || m.timestamp || m.sentAtISO).getTime()
                  : now.getTime();
              if (!Number.isNaN(msgTimeMs) && msgTimeMs < active24hWindowStartMs) continue;
              const localImgMatch = m.content.match(
                /\[LOCAL_MEDIA:image:[^\]]*fileId=([^:&\]\s]+)[^\]]*:([^\]]+)\]/i
              );
              if (localImgMatch) {
                alreadySentPhotoKeysInWindow.add(localImgMatch[1].toLowerCase());
              }
            }
          }

          const isLegacyRefusal = (txt: string) =>
            /n[aã]o\s+(?:tenho|possuo)\s+acesso|n[aã]o\s+est[aã]o\s+dispon[ií]veis\s+no\s+contexto|n[aã]o\s+consigo\s+consultar\s+o\s+tempo\s+m[eé]dio|falha\s+no\s+in[ií]cio\s+do\s+ciclo|Erro\s+na\s+compila[cç][aã]o\s+da\s+m[eé]trica|Mec[aâ]nica\s+Souza\s+Ltda|Construtora\s+Alfa|S[aã]o\s+60\s+negocia[çc][oõ]es\s+no\s+total|todas\s+as\s+60\s+negocia[çc][oõ]es\s+da\s+sua\s+carteira|A\s+lista\s+completa\s+vai\s+ficar\s+gigante\s+aqui\s+no\s+WhatsApp|Fora\s+esse,\s+n[aã]o\s+h[aá]\s+outros\s+campos\s+customizados\s+registrados|Fora\s+isso,\s+n[aã]o\s+h[aá]\s+nenhuma\s+outra\s+nota\s+ou\s+atividade\s+detalhada\s+no\s+hist[oó]rico\s+do\s+card|N[aã]o\s+encontrei\s+o\s+cat[aá]logo\s+t[eé]cnico\s+ou\s+as\s+especifica[çc][oõ]es\s+da\s+APF300-2B/i.test(
              txt || ""
            );

          const chronologicalRecentRows = [...activeSessionChatRows].reverse();

          const modelToCodeMap = getModelToInternalCodeMap();
          const buildPhotoHistoryAnnotation = (rawContent: string, meta?: Record<string, any>): string => {
            const cp = meta?.catalogPhoto;
            const localImgMatch = (rawContent || "").match(
              /\[LOCAL_MEDIA:image:[^\]]*:([^\]]+)\]/i
            );
            const photoFileName = cp?.fileName || (localImgMatch ? localImgMatch[1].trim() : "");
            if (!photoFileName && !cp?.modelDisplay) return "";
            const modelDisplay =
              cp?.modelDisplay ||
              photoFileName.replace(/\.(jpg|jpeg|png|webp|gif)$/i, "").trim();
            const compactKey =
              (cp?.modelKey || modelDisplay || "")
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9+]/g, "");
            const internalCode = cp?.internalCode || (compactKey ? modelToCodeMap.get(compactKey) : undefined);
            return ` [FOTO OFICIAL ENVIADA NESTE BALÃO: Arquivo "${photoFileName}" | Modelo exato na foto: ${modelDisplay}${internalCode ? ` | Código Interno ERP: ${internalCode}` : ""}]`;
          };

          // Mensagens recentes em ordem da MAIS RECENTE para a mais antiga (para resolver pedidos diretos como "me manda uma foto dela")
          const recentHistoryMessagesMostRecentFirst: string[] =
            useManagerContext && Array.isArray(threadHistory)
              ? [...threadHistory]
                  .reverse()
                  .filter(
                    (m: any) =>
                      m &&
                      typeof m.content === "string" &&
                      m.content.trim() !== "[object Object]" &&
                      !isLegacyRefusal(m.content)
                  )
                  .slice(0, 8)
                  .map((m: any) => String(m.content || ""))
              : activeSessionChatRows
                  .filter(
                    (r) =>
                      (r.content || "").trim() !== "[object Object]" &&
                      !(r.direction === "from_agent" && isLegacyRefusal(r.content || ""))
                  )
                  .slice(0, 8)
                  .map((r) => r.content || "");

          let chatHistoryText = "";
          if (useManagerContext && Array.isArray(threadHistory)) {
            chatHistoryText = threadHistory
              .filter(
                (m: any) =>
                  m &&
                  typeof m.content === "string" &&
                  m.content.trim() !== "[object Object]" &&
                  !isLegacyRefusal(m.content)
              )
              .slice(-10)
              .map((m: any) => {
                const speaker = m.sender === "operator" ? operatorName : persona.name;
                const timeTag = formatHistoryTimeTag(m.createdAt || m.timestamp || m.sentAtISO);
                const photoAnnot =
                  m.sender !== "operator" ? buildPhotoHistoryAnnotation(m.content, m.metadata) : "";
                const cleanText = m.content.replace(/\[LOCAL_MEDIA:image:[^\]]+\]\s*/gi, "").trim();
                return `${timeTag}${speaker}:${photoAnnot} ${cleanText.slice(0, 500)}`;
              })
              .join("\n");
          } else {
            chatHistoryText = chronologicalRecentRows
              .filter(
                (r) =>
                  (r.content || "").trim() !== "[object Object]" &&
                  !(r.direction === "from_agent" && isLegacyRefusal(r.content || ""))
              )
              .slice(-14)
              .map((r) => {
                const speaker = r.direction === "to_agent" ? operatorName : persona.name;
                const timeTag = formatHistoryTimeTag(r.createdAt);
                const meta = parseRowMeta(r.metadata);
                const photoAnnot =
                  r.direction === "from_agent"
                    ? buildPhotoHistoryAnnotation(r.content || "", meta)
                    : "";
                const cleanText = (r.content || "")
                  .replace(/\[LOCAL_MEDIA:image:[^\]]+\]\s*/gi, "")
                  .trim();
                return `${timeTag}${speaker}:${photoAnnot} ${cleanText.slice(0, 500)}`;
              })
              .join("\n");
          }

          // Texto recente da conversa (últimas 6 mensagens cronológicas) + dealIds das mensagens recentes para resolver follow-ups como "puxe por favor", "que informações a mais vc possui dela?" ou "qual o codigo dela"
          const recentAiContextText = chronologicalRecentRows
            .filter(
              (r) =>
                (r.content || "").trim() !== "[object Object]" &&
                !(r.direction === "from_agent" && isLegacyRefusal(r.content || ""))
            )
            .slice(-6)
            .map((r) => {
              const meta = parseRowMeta(r.metadata);
              const photoAnnot =
                r.direction === "from_agent"
                  ? buildPhotoHistoryAnnotation(r.content || "", meta)
                  : "";
              return `${r.content || ""}${photoAnnot}`;
            })
            .join("\n");

          const recentDealIdsFromHistory: string[] = [];
          const existingByTempId = new Map<string, { id: string; content: string; createdAt: Date }>();
          for (const r of recentChatRows.slice(0, 12)) {
            const meta = parseRowMeta(r.metadata);
            if (typeof meta?.tempId === "string" && meta.tempId.trim() && r.direction === "to_agent") {
              existingByTempId.set(meta.tempId.trim(), {
                id: r.id,
                content: r.content || "",
                createdAt: r.createdAt || now,
              });
            }
          }
          for (const r of [...chronologicalRecentRows].reverse().slice(0, 12)) {
            const meta = parseRowMeta(r.metadata);
            if (Array.isArray(meta?.relatedDeals)) {
              for (const rd of meta.relatedDeals) {
                const dId = rd?.dealId || rd?.id;
                if (typeof dId === "string" && dId.trim() && !recentDealIdsFromHistory.includes(dId.trim())) {
                  recentDealIdsFromHistory.push(dId.trim());
                }
              }
            }
          }

          // ── Salva mensagem(ns) do usuário no banco (suportando objetos { tempId, content, createdAt } ou strings do lote de 8s) ──
          const defaultStoredUserText =
            rawContentString ||
            (hasAttachedImage
              ? `[Arquivo anexado: ${effectiveImageFileName || "Foto.jpg"}]`
              : `[Arquivo enviado: ${effectiveAttachment?.name ?? "documento"}]`);

          interface NormalizedBatchedUserMsg {
            tempId?: string;
            content: string;
            createdAt?: string;
          }

          const normalizedBatch: NormalizedBatchedUserMsg[] =
            Array.isArray(batchedUserMessages) && batchedUserMessages.length > 0
              ? batchedUserMessages
                  .map((m: any): NormalizedBatchedUserMsg | null => {
                    if (typeof m === "string") {
                      const trimmed = m.trim();
                      return trimmed && trimmed !== "[object Object]" ? { content: trimmed } : null;
                    }
                    if (m && typeof m === "object") {
                      const candidate =
                        typeof m.content === "string"
                          ? m.content
                          : typeof m.text === "string"
                          ? m.text
                          : typeof m.displayUserText === "string"
                          ? m.displayUserText
                          : "";
                      const trimmed = candidate.trim();
                      if (!trimmed || trimmed === "[object Object]") return null;
                      return {
                        tempId: typeof m.tempId === "string" ? m.tempId : undefined,
                        content: trimmed,
                        createdAt: typeof m.createdAt === "string" ? m.createdAt : undefined,
                      };
                    }
                    return null;
                  })
                  .filter((item): item is NormalizedBatchedUserMsg => item !== null)
              : [{ content: defaultStoredUserText }];

          if (normalizedBatch.length === 0) {
            normalizedBatch.push({ content: defaultStoredUserText });
          }

          const savedUserMessages: {
            id: string;
            tempId?: string;
            content: string;
            direction: "to_agent";
            createdAt: Date;
          }[] = [];

          for (let bIdx = 0; bIdx < normalizedBatch.length; bIdx++) {
            const batchItem = normalizedBatch[bIdx];
            const msgText = batchItem.content;
            const isLastInBatch = bIdx === normalizedBatch.length - 1;

            // Se esta mensagem do lote já havia sido gravada por uma requisição anterior abortada, reaproveita sem duplicar
            if (batchItem.tempId && existingByTempId.has(batchItem.tempId)) {
              const existing = existingByTempId.get(batchItem.tempId)!;
              savedUserMessages.push({
                id: existing.id,
                tempId: batchItem.tempId,
                content: msgText,
                direction: "to_agent",
                createdAt: existing.createdAt,
              });
              continue;
            }

            const msgId = `val-msg-${Date.now()}-${bIdx}-${Math.random().toString(36).slice(2, 7)}`;
            const parsedItemDate = batchItem.createdAt ? new Date(batchItem.createdAt) : null;
            const msgCreatedAt =
              parsedItemDate && !isNaN(parsedItemDate.getTime())
                ? parsedItemDate
                : new Date(now.getTime() + bIdx * 10);

            await db.insert(internalMessages).values({
              id: msgId,
              tenantId,
              operatorId,
              direction: "to_agent",
              agentType: "supervisor",
              content: msgText,
              metadata: {
                isChat: true,
                scope,
                tempId: batchItem.tempId,
                userQuery: msgText,
                knowledgeBase: knowledgeBase || tenantId,
                attachedFileInfo:
                  isLastInBatch && effectiveAttachment
                    ? { name: effectiveAttachment.name, mimeType: effectiveAttachment.mimeType }
                    : undefined,
                attachedImageInfo:
                  isLastInBatch && effectiveImageBase64
                    ? { name: effectiveImageFileName || "Imagem.jpg", dataUrl: effectiveImageBase64 }
                    : undefined,
              },
              read: 1,
              createdAt: msgCreatedAt,
            });
            savedUserMessages.push({
              id: msgId,
              tempId: batchItem.tempId,
              content: msgText,
              direction: "to_agent",
              createdAt: msgCreatedAt,
            });
          }
          const userMsgId = savedUserMessages[savedUserMessages.length - 1].id;

          // ── Contexto e extração de arquivo com Telemetria Real-Time SSE ────
          const requestStartedMs = Date.now();
          const liveExecutedSteps: AgenticThoughtStep[] = [];
          let liveTaskTitle = useManagerContext
            ? "Compilando dossiê executivo 360º da operação"
            : hasAttachedImage
            ? "Inspecionando visualmente a foto enviada"
            : "Analisando solicitação comercial";
          let liveFinishedTitle = useManagerContext
            ? "Dossiê executivo 360º compilado"
            : hasAttachedImage
            ? "Inspeção visual concluída"
            : "Consulta comercial concluída";

          const broadcastLiveProgress = (customTitle?: string, extraPreviewStep?: AgenticThoughtStep) => {
            const stepsToSend = extraPreviewStep
              ? [...liveExecutedSteps, extraPreviewStep]
              : [...liveExecutedSteps];
            emitRealTimeThoughtProgress({
              tenantId,
              operatorId,
              scope: useManagerContext ? "admin" : "operator",
              taskTitle: customTitle || liveTaskTitle,
              finishedTitle: liveFinishedTitle,
              steps: stepsToSend,
              startedAtMs: requestStartedMs,
            });
          };

          let fileContext = "";
          if (effectiveAttachment?.base64 && effectiveAttachment?.name) {
            const tFile0 = Date.now();
            const extracted = await extractFileText(
              effectiveAttachment.name,
              effectiveAttachment.mimeType || "",
              effectiveAttachment.base64
            );
            fileContext = `\n\nARQUIVO ANEXADO PELO USUÁRIO: "${effectiveAttachment.name}"\n${extracted}`;
            const fileMs = Math.max(8, Date.now() - tFile0);
            liveExecutedSteps.push({
              id: "step-attachment-extract",
              kind: "read",
              actionVerb: "Leu",
              targetLabel: effectiveAttachment.name,
              scopeTag: `#anexo • ${fileMs}ms`,
              badgeType: "file",
              detailText: `Extração de conteúdo do arquivo "${effectiveAttachment.name}" concluída em ${fileMs}ms.`,
            });
            broadcastLiveProgress();
          }

          if (effectiveImageBase64) {
            liveExecutedSteps.push({
              id: "step-image-inline",
              kind: "read",
              actionVerb: "Inspecionou",
              targetLabel: effectiveImageFileName || "foto anexada",
              scopeTag: "#multimodal-vision",
              badgeType: "vision",
              detailText: `Foto "${effectiveImageFileName || "imagem"}" decodificada em alta resolução para inspeção visual multimodal no Vertex AI.`,
            });
            broadcastLiveProgress();
          }

          let managerContextText = "";
          let operatorContextResult: OperatorContextResult | null = null;
          let activeVtexLookup: Awaited<ReturnType<typeof lookupVtexProductsForAssistant>> | null = null;
          let activeSystemGuideSources: KnowledgeSourceItem[] = [];

          const contextStartMs = Date.now();
          if (useManagerContext) {
            liveExecutedSteps.push({
              id: "step-admin-thought-1",
              kind: "thought",
              actionVerb: "Pensou por 2s",
              targetLabel: "Planejando consulta 360º nos indicadores operacionais e comerciais",
              durationSeconds: 2,
              detailText: `Analisando "${userText.slice(0, 80)}" para selecionar as tabelas de BI, funis do CRM, metas e fila de atendimento.`,
            });
            broadcastLiveProgress(liveTaskTitle, {
              id: "step-admin-bi-running",
              kind: "query",
              actionVerb: "Consultando",
              targetLabel: "director_bi_context",
              scopeTag: `#${knowledgeBase || tenantId} • em execução`,
              badgeType: "bi",
              detailText: "Leitura em tempo real dos funis do CRM, metas comerciais, filas de atendimento e alertas de SLA.",
            });
            const adminGuideMatch = resolveSystemGuideForQuery(userText, recentAiContextText);
            const [biDossierText, adminVtexRes] = await Promise.all([
              getManagerContext(contextTenantId, userText, knowledgeBase),
              lookupVtexProductsForAssistant({
                tenantId: contextTenantId,
                userQuery: userText,
                recentHistoryText: recentAiContextText,
                maxProducts: 3,
              }).catch(() => null),
            ]);
            managerContextText = biDossierText;
            if (adminGuideMatch.promptContext) {
              managerContextText += `\n\n${adminGuideMatch.promptContext}`;
              activeSystemGuideSources = adminGuideMatch.matchedPlaybooks.slice(0, 2).map((pb) => ({
                id: `guide-${pb.id}`,
                kind: "system_guide" as const,
                title: pb.title,
                subtitle: pb.moduleLabel,
                badge: "Wizard & Guia do Sistema",
                excerpt: pb.clickPath,
              }));
              liveExecutedSteps.push({
                id: "step-admin-system-guide",
                kind: "read",
                actionVerb: "Consultou",
                targetLabel:
                  adminGuideMatch.matchedPlaybooks.map((p) => p.title).slice(0, 2).join(", ") ||
                  "Onboarding Wizard & Guia do Sistema",
                scopeTag: "#onboarding-wizard",
                badgeType: "kb",
                detailText: `Mapeamento passo a passo de telas, botões e ações operacionais do sistema injetado.`,
              });
            }
            if (adminVtexRes && adminVtexRes.products.length > 0) {
              activeVtexLookup = adminVtexRes;
              managerContextText += `\n\n${adminVtexRes.promptContext}`;
              liveExecutedSteps.push({
                id: "step-admin-vtex-live",
                kind: "query",
                actionVerb: "Consultou",
                targetLabel: `VTEX Store (${adminVtexRes.products.map((p) => p.modelCode || p.skuId).slice(0, 2).join(", ")})`,
                scopeTag: "#vtex-live",
                badgeType: "kb",
                detailText: `Leitura ao vivo da loja VTEX e da página completa do produto no site (${adminVtexRes.products.length} equipamento(s)).`,
              });
            }
            const biMs = Math.max(25, Date.now() - contextStartMs);
            liveExecutedSteps.push(
              {
                id: "step-admin-crm-analyze",
                kind: "analyze",
                actionVerb: "Analisou",
                targetLabel: "crm_deals, crm_stages & commercial_goals",
                scopeTag: `#${knowledgeBase || tenantId} • ${Math.max(12, Math.round(biMs * 0.55))}ms`,
                badgeType: "crm",
                detailText: `Consolidação de pipeline aberto, vendas ganhas/perdidas, ritmo de metas e distribuição por consultor concluída.`,
              },
              {
                id: "step-admin-bi-done",
                kind: "query",
                actionVerb: "Consultou",
                targetLabel: "director_bi_context & conversations",
                scopeTag: `#dossie-360 • ${biMs}ms`,
                badgeType: "bi",
                detailText: `Dossiê executivo 360º (filas de atendimento, TMA, SLA, triagens SDR e Base de Conhecimento) compilado em ${biMs}ms.`,
              }
            );
            broadcastLiveProgress();
          } else {
            operatorContextResult = await getOperatorContext(
              contextTenantId,
              operatorId,
              operatorEmail,
              userText,
              recentAiContextText,
              (steps, taskTitle, finishedTitle) => {
                if (typeof taskTitle === "string" && taskTitle.trim()) {
                  liveTaskTitle = taskTitle;
                }
                if (typeof finishedTitle === "string" && finishedTitle.trim()) {
                  liveFinishedTitle = finishedTitle;
                }
                const validIncomingSteps = Array.isArray(steps)
                  ? steps.filter((s) => s && typeof s === "object" && typeof s.id === "string")
                  : [];
                const nonOpSteps = liveExecutedSteps.filter(
                  (s) => s && typeof s.id === "string" && !s.id.startsWith("step-op-")
                );
                liveExecutedSteps.length = 0;
                liveExecutedSteps.push(...nonOpSteps, ...validIncomingSteps);
                broadcastLiveProgress(liveTaskTitle);
              },
              hasAttachedImage,
              effectiveImageFileName,
              recentDealIdsFromHistory
            );
            liveTaskTitle = operatorContextResult.taskTitle;
            liveFinishedTitle = operatorContextResult.finishedTitle;
            activeVtexLookup = operatorContextResult.vtexLookupResult || null;
            activeSystemGuideSources = operatorContextResult.systemGuideSources || [];
            // Garante sincronização final das etapas reais do operador
            const nonOpSteps = liveExecutedSteps.filter(
              (s) => s && typeof s.id === "string" && !s.id.startsWith("step-op-")
            );
            liveExecutedSteps.length = 0;
            liveExecutedSteps.push(...nonOpSteps, ...operatorContextResult.executedSteps);
          }
          const contextDurationMs = Math.max(15, Date.now() - contextStartMs);

          // ── Pareamento de Fotos do Catálogo (Proativo na 1ª vez na janela 24h ou Sob Demanda explícita) ──
          const isExplicitPhotoReq = isExplicitMachinePhotoRequest(userText);
          const isMultiPhotoReq = isMultiOrFamilyMachinePhotoRequest(userText);
          const normUserForFollowUp = normalizeForMatch(userText);
          const isFollowUpAboutSentModelOrComparison =
            !isExplicitPhotoReq &&
            /\b(?:qual\s+(?:e\s+)?o\s+codigo\s+del[ae]|sigla\s+completa|desse\s+modelo\s+que\s+(?:vc|voce)\s+mandou|dessa\s+maquina\s+que\s+(?:vc|voce)\s+mandou|qual\s+(?:e\s+)?a\s+diferenca|por\s+que\s+(?:vc|voce)\s+mandou|mandou\s+uma\s+foto\s+primeiro|depois\s+de\s+outra|falando\s+que\s+era\s+o\s+mesmo\s+modelo)\b/i.test(
              normUserForFollowUp
            );
          const maxPhotosForTurn = isMultiPhotoReq ? 10 : isExplicitPhotoReq ? 2 : 1;

          let matchedCatalogPhotos: MatchedCatalogPhoto[] = [];
          if (!effectiveImageBase64 && !effectiveAttachment && !isFollowUpAboutSentModelOrComparison) {
            try {
              matchedCatalogPhotos = await resolveMatchingCatalogPhotos(contextTenantId, {
                userText,
                recentHistoryMessages: recentHistoryMessagesMostRecentFirst,
                alreadySentPhotoKeysInWindow,
                isExplicitRequest: isExplicitPhotoReq,
                includeFamilyMatches: isMultiPhotoReq,
                maxPhotos: maxPhotosForTurn,
              });
              if (matchedCatalogPhotos.length > 0) {
                const photoListDesc = matchedCatalogPhotos
                  .map(
                    (p) =>
                      `- Modelo **${p.modelDisplay}**${p.internalCode ? ` (Código Interno ERP: **${p.internalCode}**)` : ""}: arquivo "${p.fileName}" (foto oficial localizada na Base de Conhecimento)`
                  )
                  .join("\n");
                if (matchedCatalogPhotos.length > 1) {
                  fileContext += `\n\n═══ FOTOS OFICIAIS DE CATÁLOGO PAREADAS AUTOMATICAMENTE (${matchedCatalogPhotos.length} EQUIPAMENTOS) ═══\n${photoListDesc}\nREGRA OBRIGATÓRIA DE ENTREGA DE MÚLTIPLAS FOTOS (1 BALÃO POR EQUIPAMENTO):\nO sistema JÁ LOCALIZOU e VAI ANEXAR AUTOMATICAMENTE a foto oficial de cada um dos ${matchedCatalogPhotos.length} equipamentos listados acima no seu respectivo balão! Portanto:\n1. Gere no array "fragments" **1 balão separado para cada um dos ${matchedCatalogPhotos.length} modelos listados acima**, citando claramente o código exato do modelo em negrito (ex: "**${matchedCatalogPhotos[0].modelDisplay}**", "**${matchedCatalogPhotos[1].modelDisplay}**", etc.) e o seu Código Interno ERP quando disponível, para que o sistema vincule a foto certa em cada balão.\n2. NÃO crie um balão introdutório separado sem modelo antes das fotos — já apresente o 1º modelo logo no 1º balão.\n3. NUNCA agrupe vários modelos no mesmo balão quando estiver enviando fotos de múltiplos modelos.\n4. PROIBIDO escrever tags brutas como [SEND_IMAGE:...] no seu texto.`;
                } else {
                  fileContext += `\n\n═══ FOTO OFICIAL DE CATÁLOGO PAREADA AUTOMATICAMENTE ═══\n${photoListDesc}\nREGRA DE ENTREGA DE FOTO: O sistema JÁ ANEXOU a imagem real renderizada desta máquina diretamente no balão da sua resposta. Portanto:\n1. NUNCA diga que não consegue enviar fotos ou imagens.\n2. Se o usuário pediu a foto diretamente, confirme de forma curta e natural de colega citando o modelo exato **${matchedCatalogPhotos[0].modelDisplay}**${matchedCatalogPhotos[0].internalCode ? ` (código interno **${matchedCatalogPhotos[0].internalCode}**)` : ""} (ex: "Claro, segue aí a foto da **${matchedCatalogPhotos[0].modelDisplay}**.").\n3. Se você está explicando as especificações da máquina e enviando a foto de prontidão, entregue a explicação técnica normalmente sabendo que a foto já acompanha sua mensagem.\n4. PROIBIDO escrever tags brutas como [SEND_IMAGE:...] no seu texto e PROIBIDO fazer perguntas de qualificação de lead como "É essa que você precisa?" ou "Esse seria o modelo que você está procurando?" para o vendedor interno.`;
                }
              } else if (!isExplicitPhotoReq && alreadySentPhotoKeysInWindow.size > 0) {
                fileContext += `\n\nNOTA DE CONTROLE DE FOTOS (JANELA 24H): Fotos de máquinas que já foram enviadas proativamente nesta janela de 24h NÃO são reenviadas automaticamente, a menos que o usuário peça a foto diretamente. Portanto, responda à dúvida técnica sem prometer um novo envio de foto e NUNCA escreva tags [SEND_IMAGE:...].`;
              }
            } catch (photoPreErr: any) {
              console.warn("[valentina/messages] Erro ao pré-parear foto de catálogo:", photoPreErr?.message);
            }
          } else if (isFollowUpAboutSentModelOrComparison) {
            fileContext += `\n\nDIRETRIZ DE PRECISÃO SOBRE FOTOS ENVIADAS NO HISTÓRICO:\n- O usuário está perguntando sobre o código, sigla ou diferença do modelo cuja foto você acabou de enviar no histórico acima.\n- Consulte a anotação \`[FOTO OFICIAL ENVIADA NESTE BALÃO: Arquivo "..." | Modelo exato na foto: ... | Código Interno ERP: ...]\` no histórico recente da conversa acima e informe com 100% de exatidão o modelo e o código interno ERP da foto que foi enviada (ex: o modelo de entrada **VSF** possui código interno **PAMQGPAU079** / SKU **865**, enquanto a **VSF-30S** possui código interno **PAMQGPAU036** / SKU **237**).\n- NÃO prometa e NÃO anexe uma nova foto agora, pois o usuário está apenas tirando dúvida sobre o modelo já enviado.`;
          }

          // ── Seleciona o prompt correto (incluindo histórico + pergunta atual!) ──
          const systemPrompt = useManagerContext
            ? buildSupervisorPrompt(
                persona,
                operatorName,
                managerContextText,
                fileContext,
                chatHistoryText,
                userText,
                hasAttachedImage,
                effectiveImageFileName
              )
            : buildColeaguePrompt(
                persona,
                operatorName,
                operatorContextResult?.contextText || "",
                fileContext,
                chatHistoryText,
                userText,
                alreadyTalkingToday,
                hasAttachedImage,
                effectiveImageFileName
              );

          // ── Feature key para rastreamento de custos ─────────────────────────
          const featureKey = useManagerContext ? "supervisor_chat" : persona.chatFeatureKey;

          // ── Chama o Vertex AI (suportando imagem anexada quando houver) ─────
          let fragments: {
            text: string;
            delay?: number;
            blocks?: any[];
            catalogPhoto?: any;
            vtexProductPreview?: VtexProductPreviewItem;
            vtexProductPreviews?: VtexProductPreviewItem[];
          }[] = [];
          let mentionedConversationIds: string[] = [];
          let mentionedDealIds: string[] = [];
          let suggestedCallDealIds: string[] = [];
          let alerts: any[] = [];

          // Para interações casuais/curtas ("ta obrigado", "valeu", "ok") ou pedido curto direto de foto já localizada, usa gemini-2.5-flash para resposta quase instantânea
          const isFastPhotoDelivery = Boolean(
            isExplicitPhotoReq &&
              matchedCatalogPhotos.length > 0 &&
              userText.trim().length <= 90 &&
              !effectiveImageBase64 &&
              !effectiveAttachment
          );
          const isFastCasual = Boolean(
            (!useManagerContext && operatorContextResult?.isCasual && !effectiveImageBase64 && !effectiveAttachment) ||
              isFastPhotoDelivery
          );
          const selectedModel = isFastCasual ? "gemini-2.5-flash" : "gemini-2.5-pro";

          broadcastLiveProgress(liveTaskTitle, {
            id: "step-vertex-synthesize",
            kind: "synthesize",
            actionVerb: "Sintetizando",
            targetLabel: `resposta com ${persona.name}`,
            scopeTag: `#${selectedModel} • em execução`,
            badgeType: "ai",
            detailText: `Cruzando todas as informações e especificações coletadas para redigir a resposta estruturada de ${persona.name} via Google Vertex AI (${selectedModel}).`,
          });

          const aiStartMs = Date.now();
          try {
            const { vertexAi } = await import("../../../lib/vertex-ai");

            if (vertexAi.isReady()) {
              let promptInput: string | MultimodalPart[] = systemPrompt;
              if (effectiveImageBase64 && typeof effectiveImageBase64 === "string") {
                const match = effectiveImageBase64.match(/^data:([^;]+);base64,(.+)$/);
                const mimeType = match ? match[1] : "image/jpeg";
                const rawB64 = match ? match[2] : effectiveImageBase64;
                promptInput = [
                  { inlineData: { mimeType, data: rawB64 } },
                  { text: systemPrompt },
                ];
              }

              const aiRes = await vertexAi.generateStructuredJson<{
                fragments: { text: string; delay?: number; blocks?: any[] }[];
                mentionedConversationIds?: string[];
                mentionedDealIds?: string[];
                suggestedCallDealIds?: string[];
                alerts?: any[];
              }>(promptInput, selectedModel, undefined, {
                tenantId,
                feature: featureKey,
                metadata: { operatorId, operatorName, scope, isManager: useManagerContext },
              });

              if (aiRes?.fragments && aiRes.fragments.length > 0) {
                fragments = aiRes.fragments;
                mentionedConversationIds = Array.isArray(aiRes.mentionedConversationIds)
                  ? aiRes.mentionedConversationIds
                  : [];
                mentionedDealIds = Array.isArray(aiRes.mentionedDealIds)
                  ? aiRes.mentionedDealIds
                  : [];
                suggestedCallDealIds = Array.isArray(aiRes.suggestedCallDealIds)
                  ? aiRes.suggestedCallDealIds
                  : [];
                alerts = aiRes.alerts || [];
              }
            }
          } catch (aiErr: any) {
            console.warn("[valentina/messages] Vertex AI erro:", aiErr?.message);
          }
          const aiDurationMs = Math.max(80, Date.now() - aiStartMs);
          const totalDurationMs = Math.max(120, Date.now() - requestStartedMs);

          liveExecutedSteps.push({
            id: "step-vertex-synthesize",
            kind: "synthesize",
            actionVerb: "Gerou",
            targetLabel: `resposta contextual de ${persona.name}`,
            scopeTag: `#${selectedModel} • ${aiDurationMs}ms`,
            badgeType: "ai",
            detailText: `Síntese estruturada concluída via Vertex AI (${selectedModel}) em ${aiDurationMs}ms.`,
          });
          broadcastLiveProgress(liveFinishedTitle);

          // ── Captura e remove qualquer tag bruta [SEND_IMAGE:...] emitida pela IA ──
          const extractedSendImageUrls: string[] = [];
          fragments = fragments
            .map((f) => {
              let txt = f.text || "";
              const sendImgRegex = /\[SEND_IMAGE:([^\]]+)\]/gi;
              let sm: RegExpExecArray | null;
              while ((sm = sendImgRegex.exec(txt)) !== null) {
                if (sm[1]?.trim()) extractedSendImageUrls.push(sm[1].trim());
              }
              txt = txt.replace(/\[SEND_IMAGE:[^\]]+\]/gi, "").trim();
              if (!useManagerContext && isExplicitPhotoReq) {
                txt = txt
                  .replace(/\b[EÉ]\s+essa\s+que\s+voc[eê]\s+precisa\??/gi, "")
                  .replace(/\bEsse\s+seria\s+o\s+modelo\s+que\s+voc[eê]\s+est[aá]\s+procurando\??/gi, "")
                  .trim();
              }
              return { ...f, text: txt };
            })
            .filter((f) => f.text.length > 0 || (f.blocks && f.blocks.length > 0));

          if (
            !effectiveImageBase64 &&
            !effectiveAttachment &&
            !isFollowUpAboutSentModelOrComparison &&
            matchedCatalogPhotos.length === 0 &&
            extractedSendImageUrls.length > 0
          ) {
            try {
              const resolvedFromTag = await resolveCatalogPhotosByMediaUrls(
                contextTenantId,
                extractedSendImageUrls
              );
              if (resolvedFromTag.length > 0) {
                matchedCatalogPhotos = resolvedFromTag.slice(0, maxPhotosForTurn);
              }
            } catch {
              // Ignora erro na resolução por URL
            }
          }

          // ── Fallback amigável quando a IA não responder (ou se enviou apenas [SEND_IMAGE:...]) ──
          if (fragments.length === 0) {
            if (matchedCatalogPhotos.length > 1) {
              fragments = matchedCatalogPhotos.map((p) => ({
                text: `Essa é a **${p.displayName}**${p.internalCode ? ` (Cód. **${p.internalCode}**)` : ""}:`,
              }));
            } else if (matchedCatalogPhotos.length === 1) {
              fragments = [
                {
                  text: `Claro, segue aí a foto oficial da **${matchedCatalogPhotos[0].modelDisplay}**.`,
                },
              ];
            } else {
              fragments = [
                {
                  text: useManagerContext
                    ? `Estou com dificuldade para processar sua solicitação agora. Por favor, tente novamente em instantes. Se o problema persistir, verifique se o serviço de IA está configurado corretamente.`
                    : `Deu uma oscilada rápida aqui na consulta. Pode me mandar de novo?`,
                },
              ];
            }
          }

          // ── Pós-processamento: fragmentação natural em balões curtos + cards interativos ──
          const maxBubblesForTurn = isMultiPhotoReq || matchedCatalogPhotos.length > 2 ? 12 : 4;
          if (!useManagerContext) {
            fragments = splitIntoNaturalFragments(
              fragments,
              operatorName,
              alreadyTalkingToday,
              maxBubblesForTurn
            );
          } else {
            fragments = fragments
              .map((f) => ({ ...f, text: stripAllEmojis(f.text || "") }))
              .filter((f) => f.text.length > 0 || (f.blocks && f.blocks.length > 0));
          }

          const fullReplyText = fragments.map((f) => f.text).join("\n");

          // Se a pergunta do usuário não citava o modelo diretamente mas a resposta técnica da IA identificou e explicou uma máquina (ex: via código PAMQ... ou descrição), pareia a foto respeitando a janela de 24h
          const isMachineTopicTurn =
            isExplicitPhotoReq ||
            Boolean(operatorContextResult?.executedSteps?.some((s) => s.badgeType === "kb")) ||
            Boolean(activeVtexLookup && activeVtexLookup.previews.length > 0) ||
            /\b(?:envasadora|seladora|datador|empacotadora|fechadora|tampadora|rotuladora|encapsuladora|c[aá]psula|dosadora|alimentador|esteira|t[uú]nel|m[aá]quina|equipamento|modelo|manual|cat[aá]logo|vtex)\b/i.test(
              `${userText} ${fullReplyText}`
            );

          // Se a pergunta não citou o código do modelo mas a IA recomendou/identificou um modelo específico no texto da resposta, faz pós-pareamento na VTEX para entregar o card de preview da máquina no site
          if (
            (!activeVtexLookup || activeVtexLookup.previews.length === 0) &&
            isMachineTopicTurn &&
            !effectiveImageBase64 &&
            !effectiveAttachment &&
            !isFollowUpAboutSentModelOrComparison &&
            (isVtexOrProductAssistantQuery(userText) ||
              /\b(?:PAMQ[A-Z0-9]+|tecfag\.com\.br)\b/i.test(fullReplyText))
          ) {
            try {
              const postVtex = await lookupVtexProductsForAssistant({
                tenantId: contextTenantId,
                userQuery: `${userText}\n${fullReplyText}`,
                recentHistoryText: recentAiContextText,
                maxProducts: 3,
                forceLookup: true,
              });
              if (postVtex && postVtex.previews.length > 0) {
                activeVtexLookup = postVtex;
              }
            } catch (vtexPostErr: any) {
              console.warn("[valentina/messages] Erro ao pós-parear produto VTEX:", vtexPostErr?.message);
            }
          }

          if (
            !effectiveImageBase64 &&
            !effectiveAttachment &&
            !isFollowUpAboutSentModelOrComparison &&
            (matchedCatalogPhotos.length === 0 || isMultiPhotoReq) &&
            isMachineTopicTurn
          ) {
            try {
              const postMatched = await resolveMatchingCatalogPhotos(contextTenantId, {
                userText,
                aiReplyText: fullReplyText,
                recentHistoryMessages: recentHistoryMessagesMostRecentFirst,
                alreadySentPhotoKeysInWindow,
                isExplicitRequest: isExplicitPhotoReq,
                includeFamilyMatches: isMultiPhotoReq,
                maxPhotos: maxPhotosForTurn,
              });
              if (postMatched.length > 0) {
                matchedCatalogPhotos = postMatched;
              }
            } catch (photoPostErr: any) {
              console.warn("[valentina/messages] Erro ao pós-parear foto de catálogo:", photoPostErr?.message);
            }
          }

          // Verifica se devemos enviar o balão separado com o link e a prévia oficial da máquina na VTEX
          const shouldAppendSeparateVtexPreviewBubble = Boolean(
            activeVtexLookup &&
              activeVtexLookup.previews.length > 0 &&
              (activeVtexLookup.shouldSendSeparatePreviewBubble || isMachineTopicTurn) &&
              !effectiveImageBase64 &&
              !isFollowUpAboutSentModelOrComparison &&
              !isExplicitPhotoReq &&
              !isMultiPhotoReq
          );

          // Enriquecimento de imagem de fallback nos previews VTEX caso algum SKU não tenha retornado imagem na API VTEX
          if (activeVtexLookup && activeVtexLookup.previews.length > 0 && matchedCatalogPhotos.length > 0) {
            activeVtexLookup.previews = activeVtexLookup.previews.map((prev, idx) => ({
              ...prev,
              imageUrl:
                prev.imageUrl ||
                matchedCatalogPhotos[idx]?.rawImageUrl ||
                matchedCatalogPhotos[0]?.rawImageUrl ||
                null,
            }));
          }

          // Quando NÃO estamos enviando o balão separado de preview da VTEX (ou quando o operador pediu explicitamente a foto), anexa a foto do catálogo nos fragmentos
          if (matchedCatalogPhotos.length > 0 && fragments.length > 0 && !shouldAppendSeparateVtexPreviewBubble) {
            const buildCatalogPhotoMeta = (photo: MatchedCatalogPhoto) => ({
              fileId: photo.fileId,
              fileName: photo.fileName,
              modelKey: photo.normalizedModelKey,
              modelDisplay: photo.modelDisplay,
              internalCode: photo.internalCode,
              aliasKeys: photo.aliasKeys,
              proactive: !isExplicitPhotoReq,
              sentAtISO: now.toISOString(),
            });

            if (matchedCatalogPhotos.length === 1) {
              const photo = matchedCatalogPhotos[0];
              const safeFileName = photo.fileName.replace(/[:\]]/g, "_");
              const mediaPrefix = `[LOCAL_MEDIA:image:${photo.rawImageUrl}:${safeFileName}]`;
              // Escolhe o balão que menciona especificamente o modelo (ou o 1º balão se nenhum citar)
              let targetIdx = 0;
              for (let fIdx = 0; fIdx < fragments.length; fIdx++) {
                const foundInFrag = findCatalogPhotosInFragment(fragments[fIdx].text, [photo]);
                if (foundInFrag.length > 0) {
                  targetIdx = fIdx;
                  break;
                }
              }
              if (!fragments[targetIdx].text.startsWith("[LOCAL_MEDIA:image:")) {
                fragments[targetIdx] = {
                  ...fragments[targetIdx],
                  text: `${mediaPrefix}\n${fragments[targetIdx].text}`,
                  catalogPhoto: buildCatalogPhotoMeta(photo),
                };
              }
            } else {
              // Múltiplas fotos: vincula cada foto ao balão exato que apresenta aquele modelo
              const remainingPhotos = [...matchedCatalogPhotos];
              const assignedFragIndices = new Set<number>();

              for (let fIdx = 0; fIdx < fragments.length; fIdx++) {
                const fragText = fragments[fIdx].text || "";
                if (fragText.startsWith("[LOCAL_MEDIA:image:")) {
                  assignedFragIndices.add(fIdx);
                  continue;
                }
                // Evita colar foto de modelo em balão puramente introdutório da galeria ("Certo, vou te mandar as fotos de todos os modelos...")
                const isGenericGalleryIntro =
                  fIdx === 0 &&
                  fragments.length > 1 &&
                  /\b(?:todos\s+os\s+modelos|todas\s+as\s+fotos|da\s+linha|para\s+voc[eê]\s+comparar)\b/i.test(
                    fragText
                  ) &&
                  !/\b(?:modelo\s+de\s+entrada|30s|30a|2000|30ag)\b/i.test(fragText);
                if (isGenericGalleryIntro) continue;

                const matchesInFrag = findCatalogPhotosInFragment(fragText, remainingPhotos);
                if (matchesInFrag.length > 0) {
                  const chosenPhoto = matchesInFrag[0];
                  const safeFileName = chosenPhoto.fileName.replace(/[:\]]/g, "_");
                  const mediaPrefix = `[LOCAL_MEDIA:image:${chosenPhoto.rawImageUrl}:${safeFileName}]`;
                  fragments[fIdx] = {
                    ...fragments[fIdx],
                    text: `${mediaPrefix}\n${fragText}`,
                    catalogPhoto: buildCatalogPhotoMeta(chosenPhoto),
                  };
                  assignedFragIndices.add(fIdx);
                  const remIdx = remainingPhotos.findIndex((rp) => rp.fileId === chosenPhoto.fileId);
                  if (remIdx !== -1) remainingPhotos.splice(remIdx, 1);
                }
              }

              // Para qualquer foto da família que ainda não tenha recebido seu balão, anexa em balão disponível ou cria um balão dedicado
              for (const orphanPhoto of remainingPhotos) {
                const safeFileName = orphanPhoto.fileName.replace(/[:\]]/g, "_");
                const mediaPrefix = `[LOCAL_MEDIA:image:${orphanPhoto.rawImageUrl}:${safeFileName}]`;
                fragments.push({
                  text: `${mediaPrefix}\nEssa é a **${orphanPhoto.displayName}**${orphanPhoto.internalCode ? ` (Cód. **${orphanPhoto.internalCode}**)` : ""}:`,
                  delay: fragments.length * 650,
                  catalogPhoto: buildCatalogPhotoMeta(orphanPhoto),
                });
              }

              // Garantia final: se algum balão intermediário de legenda ("Essa é a ...:") ficou sem foto, resolve e anexa
              for (let fIdx = 0; fIdx < fragments.length; fIdx++) {
                const fText = fragments[fIdx].text || "";
                if (
                  !fText.startsWith("[LOCAL_MEDIA:image:") &&
                  /^(?:Essa\s+[eé]\s+a|Aqui\s+a|Este\s+[eé]\s+o|E\s+por\s+fim,\s+a)\s+/i.test(
                    fText.trim()
                  )
                ) {
                  const fallbackForCaption = findCatalogPhotosInFragment(fText, matchedCatalogPhotos);
                  if (fallbackForCaption.length > 0) {
                    const p = fallbackForCaption[0];
                    const safeFileName = p.fileName.replace(/[:\]]/g, "_");
                    fragments[fIdx] = {
                      ...fragments[fIdx],
                      text: `[LOCAL_MEDIA:image:${p.rawImageUrl}:${safeFileName}]\n${fText}`,
                      catalogPhoto: buildCatalogPhotoMeta(p),
                    };
                  }
                }
              }
            }

            liveExecutedSteps.push({
              id: "step-catalog-photo-pair",
              kind: "read",
              actionVerb: isExplicitPhotoReq ? "Localizou foto" : "Pareou foto",
              targetLabel: matchedCatalogPhotos.map((p) => p.fileName).join(", "),
              scopeTag: isExplicitPhotoReq ? "#catalogo-sob-demanda" : "#catalogo-proativo-24h",
              badgeType: "vision",
              detailText: isExplicitPhotoReq
                ? `Imagem(ns) oficial(is) localizada(s) no catálogo da Base de Conhecimento (${matchedCatalogPhotos.length} foto(s)).`
                : `Imagem oficial pareada proativamente com o equipamento (${matchedCatalogPhotos
                    .map((p) => p.modelDisplay)
                    .join(", ")}) respeitando o controle anti-repetição da janela de 24h.`,
            });
          }

          // ── Balão separado com o Link da Máquina no Site + Card Oficial de Preview da VTEX ──
          if (shouldAppendSeparateVtexPreviewBubble && activeVtexLookup && activeVtexLookup.previews.length > 0) {
            const primaryPreview = activeVtexLookup.previews[0];
            const firstMatchedPhoto = matchedCatalogPhotos[0];
            const catalogPhotoMetaForHistory = firstMatchedPhoto
              ? {
                  fileId: firstMatchedPhoto.fileId,
                  fileName: firstMatchedPhoto.fileName,
                  modelKey: firstMatchedPhoto.normalizedModelKey,
                  modelDisplay: firstMatchedPhoto.modelDisplay,
                  internalCode: firstMatchedPhoto.internalCode,
                  aliasKeys: firstMatchedPhoto.aliasKeys,
                  proactive: true,
                  sentAtISO: now.toISOString(),
                }
              : undefined;

            const vtexBubbleText =
              activeVtexLookup.previews.length > 1
                ? `Segue abaixo o link direto e a prévia oficial da **${primaryPreview.name}** (e modelos relacionados) na loja VTEX para abrir no site:`
                : `Segue abaixo o link direto e a prévia oficial da **${primaryPreview.name}** na loja VTEX para abrir no site:`;

            fragments.push({
              text: vtexBubbleText,
              delay: Math.max(650, fragments.length * 650),
              catalogPhoto: catalogPhotoMetaForHistory,
              vtexProductPreview: primaryPreview,
              vtexProductPreviews: activeVtexLookup.previews.slice(0, 3),
            });
          }

          const relatedDeals = !useManagerContext
            ? resolveRelatedDeals(
                mentionedDealIds,
                suggestedCallDealIds,
                fullReplyText,
                userText,
                operatorContextResult,
                operatorName
              )
            : [];
          const relatedConversations = !useManagerContext
            ? resolveRelatedConversations(
                mentionedConversationIds,
                fullReplyText,
                userText,
                operatorContextResult,
                relatedDeals,
                operatorName
              )
            : [];
          const relatedCalls = !useManagerContext
            ? resolveRelatedCalls(
                suggestedCallDealIds,
                relatedDeals,
                relatedConversations,
                fullReplyText,
                userText,
                operatorContextResult
              )
            : [];

          // ── Constrói a árvore agêntica de raciocínio e ações REAIS executadas ──
          const candidateSearchTerms = extractSearchCandidateTerms(userText);
          const thoughtTrace = buildAgenticThoughtTrace({
            userQuery: userText,
            scope: useManagerContext ? "admin" : "operator",
            personaName: persona.name,
            knowledgeBase: knowledgeBase || tenantId,
            attachedFileName: attachment?.name || null,
            hasAttachedImage: Boolean(imageBase64),
            totalDurationMs,
            contextDurationMs,
            aiDurationMs,
            executedSteps: liveExecutedSteps,
            customTaskTitle: liveTaskTitle,
            customFinishedTitle: liveFinishedTitle,
            extraSummary: {
              dealsCount: operatorContextResult?.knownDeals?.length,
              waitingCount: operatorContextResult?.waitingConversations?.length,
              callsCount: relatedCalls.length,
              searchTerms: candidateSearchTerms.length > 0 ? candidateSearchTerms : undefined,
            },
          });

          // ── Salva fragmentos no banco ───────────────────────────────────────
          const savedFragments: any[] = [];
          const usedKbInTurn = Boolean(
            (fileContext && fileContext.trim().length > 0) ||
              liveExecutedSteps.some((s) => s.badgeType === "kb")
          );
          for (let i = 0; i < fragments.length; i++) {
            const frag = fragments[i];
            const isFirstFrag = i === 0;
            const isLastFrag = i === fragments.length - 1;
            const fragRelated =
              isLastFrag && relatedConversations.length > 0 ? relatedConversations : undefined;
            const fragRelatedDeals =
              isLastFrag && relatedDeals.length > 0 ? relatedDeals : undefined;
            const fragRelatedCalls =
              isLastFrag && relatedCalls.length > 0 ? relatedCalls : undefined;
            const fragThoughtTrace = isFirstFrag ? thoughtTrace : undefined;
            const fragId = `val-ai-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
            const fragTimestamp = new Date(now.getTime() + 500 + i * 650);

            const resolvedSources = await resolveKnowledgeSourcesForMessage({
              tenantId: contextTenantId,
              userQuery: userText,
              aiReplyText: frag.text || fullReplyText,
              catalogPhoto: frag.catalogPhoto || null,
              usedKnowledgeBase: usedKbInTurn,
              hasCrmContext: Boolean(
                (fragRelated && fragRelated.length > 0) ||
                  (fragRelatedDeals && fragRelatedDeals.length > 0) ||
                  (fragRelatedCalls && fragRelatedCalls.length > 0)
              ),
              vtexSources: activeVtexLookup?.knowledgeSources,
              systemGuideSources: activeSystemGuideSources,
            });

            await db.insert(internalMessages).values({
              id: fragId,
              tenantId,
              operatorId,
              direction: "from_agent",
              agentType: "supervisor",
              content: frag.text,
              metadata: {
                isChat: true,
                scope,
                fragmentIndex: i,
                totalFragments: fragments.length,
                userQuery: isFirstFrag ? userText : undefined,
                blocks: frag.blocks || undefined,
                catalogPhoto: frag.catalogPhoto || undefined,
                vtexProductPreview: frag.vtexProductPreview || undefined,
                vtexProductPreviews: frag.vtexProductPreviews || undefined,
                knowledgeSources: resolvedSources.sources,
                knowledgeSourceStatus: resolvedSources.status,
                knowledgeSourceStatusLabel: resolvedSources.statusLabel,
                knowledgeSourceStatusDescription: resolvedSources.statusDescription,
                relatedConversations: fragRelated,
                relatedDeals: fragRelatedDeals,
                relatedCalls: fragRelatedCalls,
                thoughtTrace: fragThoughtTrace,
                isManager: useManagerContext,
              },
              read: 0,
              createdAt: fragTimestamp,
            });

            savedFragments.push({
              id: fragId,
              content: frag.text,
              blocks: frag.blocks || undefined,
              catalogPhoto: frag.catalogPhoto || undefined,
              vtexProductPreview: frag.vtexProductPreview || undefined,
              vtexProductPreviews: frag.vtexProductPreviews || undefined,
              knowledgeSources: resolvedSources.sources,
              knowledgeSourceStatus: resolvedSources.status,
              knowledgeSourceStatusLabel: resolvedSources.statusLabel,
              knowledgeSourceStatusDescription: resolvedSources.statusDescription,
              relatedConversations: fragRelated,
              relatedDeals: fragRelatedDeals,
              relatedCalls: fragRelatedCalls,
              thoughtTrace: fragThoughtTrace,
              direction: "from_agent",
              createdAt: fragTimestamp,
            });
          }

          return new Response(
            JSON.stringify({
              success: true,
              userMessage: { id: userMsgId, content: userText, direction: "to_agent", createdAt: now },
              userMessages: savedUserMessages,
              thoughtTrace,
              fragments: savedFragments.map((f, i) => ({
                ...f,
                delay: fragments[i]?.delay ?? i * 650,
              })),
              alerts,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});


