import { z } from "zod";
import {
  normalizeTriageText,
  resolveIndustrialRoute,
  type IndustrialRoute,
} from "./industrial-policy.ts";
import type { IndustrialMachine, IndustrialSettings } from "./industrial-settings.ts";

export interface MachineDecision {
  status: "confirmed" | "review" | "not_offered";
  machineId: string | null;
  candidateMachineIds?: string[];
  line: IndustrialMachine["line"] | null;
  confidence: number;
  method: "exact_catalog" | "exact_catalog_line" | "vertex_catalog" | "vertex_catalog_line" | "rule";
  reason: string;
  catalogRevision: number;
  catalogFingerprint?: string;
  highCapitalSocialAlert?: boolean;
  capitalSocial?: number;
  lineCorrectedFromCatalog?: boolean;
}
export interface MachineDecisionInput {
  interest: string;
  application: string;
  production: string;
  /** Somente falas do cliente; respostas anteriores do bot não constituem evidência de intenção. */
  customerContext: string;
  capitalSocial?: number;
}
export function parseIndustrialCapital(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.replace(/R\$|\s/g, "");
  const normalized =
    /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text) || /^\d+(?:,\d{1,2})?$/.test(text)
      ? text.replaceAll(".", "").replace(",", ".")
      : /^\d+(?:\.\d{1,2})?$/.test(text)
        ? text
        : "";
  return normalized ? Number(normalized) : undefined;
}
const suggestionSchema = z
  .object({
    machineId: z.string().min(1).max(160).nullable(),
    candidateMachineIds: z.array(z.string().min(1).max(160)).max(6).optional(),
    confidence: z.number().finite().min(0).max(1),
    reason: z.string().max(600),
  })
  .strict();

/**
 * Proteção defensiva enquanto o catálogo oficial não passa pela higienização completa:
 * itens etiquetados como PERSONNALITE cujo próprio nome declara máquina Manual, Semiautomática
 * ou de Pedal (ex.: "Seladora em L Manual" BSF-501, "FQS450 - SELADORA L SEMI AUTOMATICA COM TUNEL")
 * são reclassificados defensivamente para SEMI-INDUSTRIAL para evitar falsos Personnalité.
 */
export function resolveEffectiveCatalogLine(machine: IndustrialMachine): {
  line: IndustrialMachine["line"];
  corrected: boolean;
} {
  if (machine.line !== "PERSONNALITE") {
    return { line: machine.line, corrected: false };
  }
  const normName = normalizeTriageText(machine.name || "");
  const isManualOrSemiName =
    /\b(?:manual|semi\s*automatic[ao]|semiautomatic[ao]|de\s+pedal)\b/.test(normName) &&
    !/\b(?:termoformadora|blister|encapsuladora|prensa|comprimidos)\b/.test(normName);
  if (isManualOrSemiName) {
    return { line: "SEMI-INDUSTRIAL", corrected: true };
  }
  return { line: machine.line, corrected: false };
}
const categories = [
  "seladora",
  "envasadora",
  "empacotadora",
  "dosadora",
  "enchedora",
  "rotuladora",
  "datador",
  "encapsuladora",
  "contadora",
  "termoformadora",
  "rosqueadeira",
  "arqueadora",
  "cintadora",
  "tunel",
  "fechadora",
  "montadora",
  "encaixotadora",
  "envolvedora",
  "paletizadora",
  "cortadora",
  "dispensador",
  "misturador",
  "moinho",
  "polidora",
];
const STOPWORDS = new Set([
  "para",
  "com",
  "sem",
  "por",
  "uma",
  "uns",
  "umas",
  "dos",
  "das",
  "nos",
  "nas",
  "quero",
  "preciso",
  "procuro",
  "busco",
  "gostaria",
  "orcamento",
  "cotacao",
  "comprar",
  "maquina",
  "maquinas",
  "equipamento",
  "equipamentos",
  "industrial",
  "industriais",
  "unidades",
  "unidade",
  "pacotes",
  "pacote",
  "embalagens",
  "embalagem",
  "dia",
  "hora",
  "minuto",
]);
const normalized = (text: string) =>
  normalizeTriageText(text)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const termIn = (text: string, term: string) =>
  Boolean(term.trim()) && ` ${normalized(text)} `.includes(` ${normalized(term)} `);
function namedMachineCategories(text: string) {
  const words = normalized(text).split(" ");
  return categories.filter((category) =>
    words.some((word) => word === category || word === `${category}s`),
  );
}
export function machineCategories(text: string) {
  const norm = normalized(text);
  const explicit = namedMachineCategories(text);
  const words = norm.split(" ");
  const isVacuumSealerPhrase =
    words.includes("vacuo") &&
    !words.includes("emulsificador") &&
    !words.includes("forming") &&
    !words.includes("termoformadora") &&
    !words.includes("misturador") &&
    !words.includes("tanque") &&
    !explicit.includes("termoformadora") &&
    !explicit.includes("misturador");
  const synonyms: Record<string, string[]> = {
    seladora: ["selar", "selagem"],
    envasadora: ["envase", "envasar", "envasamento", "envazamento", "envaz"],
    empacotadora: isVacuumSealerPhrase
      ? ["empacotar", "empacotamento", "flowpack"]
      : ["empacotar", "empacotamento", "embaladora", "flowpack"],
    dosadora: ["dosar", "dosagem"],
    enchedora: ["encher", "enchimento", "enchim"],
    rotuladora: ["rotular", "rotulagem"],
    datador: ["datar", "datacao", "codificadora", "codificador", "inkjet"],
    rosqueadeira: ["rosquear", "rosqueadora", "tampadora", "recravadeira"],
    termoformadora: ["blister", "termoformagem"],
    arqueadora: ["arquear", "arqueacao", "cintar", "cintadora"],
    cintadora: ["cintar", "arquear", "arqueadora"],
    tunel: ["encolhimento", "shrink"],
    fechadora: ["fechar", "fechamento"],
    montadora: ["montar", "montagem", "armadora"],
    encaixotadora: ["encaixotar", "encaixotamento"],
    envolvedora: ["envolver", "stretch", "estiravel"],
  };
  return Array.from(
    new Set([
      ...explicit,
      ...(isVacuumSealerPhrase ? ["seladora"] : []),
      ...Object.entries(synonyms)
        .filter(([, terms]) => terms.some((term) => words.includes(term)))
        .map(([category]) => category),
    ]),
  );
}
function compatibleCategory(interest: string, machine: IndustrialMachine) {
  const literalName = namedMachineCategories(machine.name);
  const fromName = literalName.length ? literalName : machineCategories(machine.name);
  const offered = fromName.length ? fromName : namedMachineCategories(machine.description || "");

  // Quando o interesse traz alternativas separadas por "/" ou "ou" (ex.: "Seladora / Empacotadora automática"),
  // aceita qualquer categoria alternativa compatível em vez de exigir que 1 máquina tenha ambos os nomes.
  const alternativeSegments = String(interest || "")
    .split(/\s*(?:\/|\bou\b)\s*/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (alternativeSegments.length > 1) {
    const segmentCategoryGroups = alternativeSegments
      .map((segment) => machineCategories(segment))
      .filter((cats) => cats.length > 0);
    if (segmentCategoryGroups.length > 0) {
      return segmentCategoryGroups.some((group) =>
        group.every((category) => offered.includes(category)),
      );
    }
  }

  const requested = machineCategories(interest);
  return !requested.length || requested.every((category) => offered.includes(category));
}
function narrowBroadCandidates(
  candidates: IndustrialMachine[],
  input: MachineDecisionInput,
  hasExplicitCategory: boolean,
): IndustrialMachine[] {
  if (candidates.length <= 100) return candidates;
  const queryText = normalized(
    `${input.interest} ${input.application} ${input.production} ${input.customerContext}`,
  );
  const queryTokens = Array.from(
    new Set(
      queryText
        .split(" ")
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
    ),
  );
  const scored = candidates.map((machine, index) => {
    const nameTokens = normalized(
      `${machine.name} ${machine.code} ${machine.sku} ${machine.aliases.join(" ")}`,
    );
    const descTokens = normalized(`${machine.description || ""} ${machine.production || ""}`);
    let score = 0;
    for (const token of queryTokens) {
      if (` ${nameTokens} `.includes(` ${token} `)) score += 4;
      else if (nameTokens.includes(token)) score += 2;
      else if (` ${descTokens} `.includes(` ${token} `)) score += 2;
      else if (descTokens.includes(token)) score += 1;
    }
    return { machine, score, index };
  });
  const maxScore = scored.reduce((max, item) => Math.max(max, item.score), 0);
  if (!hasExplicitCategory && maxScore === 0) return [];
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, 100).map((item) => item.machine);
}
export function prepareMachineDecision(
  settings: IndustrialSettings,
  revision: number,
  input: MachineDecisionInput,
) {
  const review = (reason: string): MachineDecision => ({
    status: "review",
    machineId: null,
    line: null,
    confidence: 0,
    method: "rule",
    reason,
    catalogRevision: revision,
  });
  const blockedDecision = detectBlockedMachineFamily(settings, revision, input.interest);
  if (blockedDecision) return { decision: blockedDecision, candidates: [] };
  if (
    /\b(revenda|revender|revendedor\w*|licitacao|licitacoes|edital|editais|pregao|pregoes)\b/.test(
      normalized(input.customerContext),
    )
  )
    return { decision: review("resale_or_tender"), candidates: [] };
  const active = settings.catalog.filter((machine) => machine.active);
  if (!active.length) return { decision: review("catalog_empty"), candidates: [] };
  const exact = active.filter((machine) =>
    [machine.code, machine.sku, machine.name, ...machine.aliases]
      .filter((term) => term.length >= 3)
      .some((term) => {
        const referenceIn = (text: string) =>
          /^\d+$/.test(term)
            ? ["sku", "codigo", "cod", "modelo"].some((prefix) => termIn(text, `${prefix} ${term}`))
            : termIn(text, term);
        return referenceIn(input.interest) && referenceIn(input.customerContext);
      }),
  );
  if (exact.length > 1) {
    const compatibleExact = exact.filter((machine) => compatibleCategory(input.interest, machine));
    if (compatibleExact.length > 0) {
      const resolvedExact = compatibleExact.map((machine) => ({
        machine,
        effective: resolveEffectiveCatalogLine(machine),
      }));
      const distinctLines = new Set(resolvedExact.map((item) => item.effective.line));
      const anyOverCapacity = resolvedExact.some((item) =>
        exceedsCatalogCapacity(input.production, item.machine.production),
      );
      if (distinctLines.size === 1 && !anyOverCapacity) {
        const [commonLine] = Array.from(distinctLines);
        const highCapitalSocialAlert =
          commonLine === "SEMI-INDUSTRIAL" && (input.capitalSocial || 0) >= 350_000;
        const decision: MachineDecision = {
          status: "confirmed",
          machineId: null,
          candidateMachineIds: resolvedExact.map((item) => item.machine.id),
          line: commonLine,
          confidence: 0.95,
          method: "exact_catalog_line",
          reason: "catalog_line_confirmed_model_tbd",
          catalogRevision: revision,
          highCapitalSocialAlert,
          ...(highCapitalSocialAlert ? { capitalSocial: input.capitalSocial } : {}),
          ...(resolvedExact.some((item) => item.effective.corrected)
            ? { lineCorrectedFromCatalog: true }
            : {}),
        };
        return {
          decision,
          candidates: [],
        };
      }
    }
    return { decision: review("ambiguous_exact_match"), candidates: [] };
  }
  if (exact.length === 1)
    return {
      decision: confirmMachine(exact[0], revision, input, "exact_catalog", 1),
      candidates: [],
    };
  const requested = machineCategories(input.interest);
  const rawCandidates = active.filter(
    (machine) => !requested.length || compatibleCategory(input.interest, machine),
  );
  if (!rawCandidates.length) return { decision: review("no_category_match"), candidates: [] };
  const candidates = narrowBroadCandidates(rawCandidates, input, requested.length > 0);
  if (!candidates.length)
    return { decision: review("catalog_search_too_broad"), candidates: [] };
  return { decision: null, candidates };
}
export function detectBlockedMachineFamily(
  settings: IndustrialSettings,
  revision: number,
  interest: string,
): MachineDecision | null {
  const blocked = settings.blockedFamilies.find((family) =>
    family.terms.some((term) => termIn(interest, term)),
  );
  return blocked
    ? {
        status: "not_offered",
        machineId: null,
        line: null,
        confidence: 1,
        method: "rule",
        reason: `blocked_family:${blocked.id}`,
        catalogRevision: revision,
      }
    : null;
}
function confirmMachine(
  machine: IndustrialMachine,
  revision: number,
  input: MachineDecisionInput,
  method: MachineDecision["method"],
  confidence: number,
): MachineDecision {
  const { line: effectiveLine, corrected } = resolveEffectiveCatalogLine(machine);
  let reason = "catalog_confirmed";
  if (!compatibleCategory(input.interest, machine)) reason = "category_conflict";
  else if (exceedsCatalogCapacity(input.production, machine.production))
    reason = "capacity_requires_review";
  // Decisão 3: Capital Social >= R$ 350.000 NÃO derruba mais o destino para Análise e revisão humana;
  // vira alerta informativo no card de Aprovação SDR para o avaliador decidir se sobe para Personnalité.
  const highCapitalSocialAlert =
    effectiveLine === "SEMI-INDUSTRIAL" && (input.capitalSocial || 0) >= 350_000;
  return {
    status: reason === "catalog_confirmed" ? "confirmed" : "review",
    machineId: machine.id,
    line: effectiveLine,
    confidence,
    method,
    reason,
    catalogRevision: revision,
    highCapitalSocialAlert,
    ...(highCapitalSocialAlert ? { capitalSocial: input.capitalSocial } : {}),
    ...(corrected ? { lineCorrectedFromCatalog: true } : {}),
  };
}
/** Compara somente unidade e período compatíveis; não inventa jornada diária nem densidade. */
function exceedsCatalogCapacity(declared: string, catalog: string): boolean {
  const quantity = (raw: string) => {
    const text = raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const match = text.match(
      /(\d+(?:[.,]\d+)*)(?:\s*(?:a|ate|[-–~])\s*(\d+(?:[.,]\d+)*))?\s*(embalagens?|emb|unidades?|unid|un|pecas?|kg|litros?|l)?\s*(?:\/|por\s+)\s*(minutos?|min|horas?|h|dias?|dia)\b/,
    );
    if (!match) return null;
    const value = parseIndustrialCapital(match[2] || match[1]);
    if (value === undefined) return null;
    const unit =
      match[3] === "kg" ? "mass" : /^(l|litro)/.test(match[3] || "") ? "liquid" : "units";
    const period = match[4].startsWith("dia") ? "day" : "hour";
    return { value: value * (match[4].startsWith("min") ? 60 : 1), unit, period };
  };
  const demand = quantity(declared),
    capacity = quantity(catalog);
  return Boolean(
    demand &&
    capacity &&
    demand.unit === capacity.unit &&
    demand.period === capacity.period &&
    demand.value > capacity.value,
  );
}
export function validateMachineSuggestion(
  raw: unknown,
  candidates: IndustrialMachine[],
  revision: number,
  input: MachineDecisionInput,
): MachineDecision {
  const result = suggestionSchema.safeParse(raw);
  if (!result.success) {
    return {
      status: "review",
      machineId: null,
      line: null,
      confidence: 0,
      method: "vertex_catalog",
      reason: "unconfirmed_model_match",
      catalogRevision: revision,
    };
  }

  const machine = result.data.machineId
    ? candidates.find((candidate) => candidate.id === result.data.machineId && candidate.active)
    : null;

  if (machine && result.data.confidence >= 0.95) {
    // A linha e o nome vêm do catálogo do tenant (com proteção defensiva p/ Manual/Semi);
    // o JSON do modelo só sugere um ID.
    return confirmMachine(machine, revision, input, "vertex_catalog", result.data.confidence);
  }

  // Decisão 3: múltiplos modelos compatíveis da MESMA linha no catálogo (sem conflito Semi x Personnalité)
  // já confirmam a LINHA para pré-preencher a Aprovação SDR (mantendo 100% da revisão humana SDR).
  const rawCandidateIds = Array.isArray(result.data.candidateMachineIds)
    ? Array.from(new Set(result.data.candidateMachineIds))
    : [];
  if (rawCandidateIds.length > 0 && result.data.confidence >= 0.85) {
    const matchedCandidates = rawCandidateIds
      .map((id) => candidates.find((candidate) => candidate.id === id && candidate.active))
      .filter((item): item is IndustrialMachine => Boolean(item))
      .filter((item) => compatibleCategory(input.interest, item));

    if (matchedCandidates.length > 0) {
      const resolved = matchedCandidates.map((item) => ({
        machine: item,
        effective: resolveEffectiveCatalogLine(item),
      }));
      const distinctLines = new Set(resolved.map((item) => item.effective.line));
      if (distinctLines.size > 1) {
        return {
          status: "review",
          machineId: null,
          candidateMachineIds: resolved.map((item) => item.machine.id),
          line: null,
          confidence: result.data.confidence,
          method: "vertex_catalog_line",
          reason: "ambiguous_line_conflict",
          catalogRevision: revision,
        };
      }
      const anyOverCapacity = resolved.some((item) =>
        exceedsCatalogCapacity(input.production, item.machine.production),
      );
      if (anyOverCapacity) {
        return {
          status: "review",
          machineId: null,
          candidateMachineIds: resolved.map((item) => item.machine.id),
          line: Array.from(distinctLines)[0],
          confidence: result.data.confidence,
          method: "vertex_catalog_line",
          reason: "capacity_requires_review",
          catalogRevision: revision,
        };
      }
      const [commonLine] = Array.from(distinctLines);
      const highCapitalSocialAlert =
        commonLine === "SEMI-INDUSTRIAL" && (input.capitalSocial || 0) >= 350_000;
      return {
        status: "confirmed",
        machineId: null,
        candidateMachineIds: resolved.map((item) => item.machine.id),
        line: commonLine,
        confidence: result.data.confidence,
        method: "vertex_catalog_line",
        reason: "catalog_line_confirmed_model_tbd",
        catalogRevision: revision,
        highCapitalSocialAlert,
        ...(highCapitalSocialAlert ? { capitalSocial: input.capitalSocial } : {}),
        ...(resolved.some((item) => item.effective.corrected)
          ? { lineCorrectedFromCatalog: true }
          : {}),
      };
    }
  }

  return {
    status: "review",
    machineId: null,
    line: null,
    confidence: 0,
    method: "vertex_catalog",
    reason: "unconfirmed_model_match",
    catalogRevision: revision,
  };
}
export function applyMachineDecision(
  route: IndustrialRoute,
  decision: MachineDecision,
): IndustrialRoute {
  if (!route.subflow || !["MAQUINAS", "PERSONNALITE"].includes(route.subflow)) return route;
  if (decision.status === "not_offered")
    return { ...route, needsReview: true, reason: "specialist_review" };
  if (decision.status !== "confirmed")
    return {
      ...(decision.line && decision.confidence >= 0.95
        ? resolveIndustrialRoute({
            collectedData: {},
            aiSubflow: route.subflow,
            machineEvidence: {
              source: "catalog",
              group: decision.line,
              confidence: decision.confidence,
            },
          })
        : route),
      needsReview: true,
      reason: "classification_pending",
    };
  return resolveIndustrialRoute({
    collectedData: {},
    aiSubflow: route.subflow,
    machineEvidence: { source: "catalog", group: decision.line!, confidence: decision.confidence },
  });
}
export async function decideIndustrialMachine(params: {
  settings: IndustrialSettings;
  revision: number;
  input: MachineDecisionInput;
  suggest: (candidates: IndustrialMachine[]) => Promise<unknown>;
}): Promise<MachineDecision> {
  const prepared = prepareMachineDecision(params.settings, params.revision, params.input);
  if (prepared.decision) return prepared.decision;
  try {
    return validateMachineSuggestion(
      await params.suggest(prepared.candidates),
      prepared.candidates,
      params.revision,
      params.input,
    );
  } catch {
    return {
      status: "review",
      machineId: null,
      line: null,
      confidence: 0,
      method: "vertex_catalog",
      reason: "decisor_unavailable",
      catalogRevision: params.revision,
    };
  }
}
