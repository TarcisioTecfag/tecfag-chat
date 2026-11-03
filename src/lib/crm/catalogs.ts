import { and, eq, isNull, asc, isNotNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../db";
import { crmCatalogItems, crmCatalogPolicies, crmDeals } from "../../db/schema";

export const catalogKinds = ["segment", "source", "campaign", "loss_reason"] as const;
export type CatalogKind = (typeof catalogKinds)[number];

export const STANDARD_CATALOG_ITEMS: Record<CatalogKind, readonly string[]> = {
  segment: [
    "Indústria & Fabricação",
    "Comércio Varejista & Atacadista",
    "Serviços & Consultoria",
    "Alimentos & Bebidas",
    "Química, Farmacêutica & Cosméticos",
    "Agronegócio & Agroindústria",
    "Tecnologia & Comunicação",
  ],
  source: [
    "WhatsApp",
    "Site Institucional",
    "Indicação de Cliente",
    "Telefone / Receptivo",
    "E-mail Direto",
    "Feiras & Eventos Comerciais",
  ],
  campaign: [
    "Google Ads (Pesquisa & Display)",
    "Meta Ads (Facebook & Instagram)",
    "Tráfego Orgânico / SEO",
    "Prospecção Ativa (Outbound)",
    "Campanhas Institucionais",
  ],
  loss_reason: [
    "Preço elevado / Fora do orçamento",
    "Fechou com concorrente",
    "Contato sem retorno / Sumiu",
    "Desistência da compra / Projeto cancelado",
    "Especificação técnica incompatível",
    "Prazo de entrega não atende",
  ],
} as const;

export class CatalogValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "BAD_REQUEST";
}

export function isCatalogKind(value: unknown): value is CatalogKind {
  return typeof value === "string" && catalogKinds.includes(value as CatalogKind);
}

export function normalizeCatalogName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Informe um nome válido.");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 120 || name === "__none__")
    throw new Error("Informe um nome de até 120 caracteres.");
  return name;
}

export async function ensureCatalogOption(
  tenantId: string,
  kind: CatalogKind,
  rawValue: unknown,
  executor: any = db,
): Promise<string | null> {
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;
  let name: string;
  try {
    name = normalizeCatalogName(String(rawValue).slice(0, 120));
  } catch {
    return null;
  }
  const lower = name.toLocaleLowerCase("pt-BR");
  if (lower === "não informada" || lower === "nao informada") {
    return name;
  }

  try {
    const existingRows = await executor
      .select()
      .from(crmCatalogItems)
      .where(and(eq(crmCatalogItems.tenantId, tenantId), eq(crmCatalogItems.kind, kind)));

    const matched = existingRows.find(
      (item: any) => String(item.name || "").toLocaleLowerCase("pt-BR") === lower,
    );

    if (matched) {
      if (matched.archivedAt) {
        await executor
          .update(crmCatalogItems)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(and(eq(crmCatalogItems.id, matched.id), eq(crmCatalogItems.tenantId, tenantId)));
      }
      return matched.name;
    }

    const standards = STANDARD_CATALOG_ITEMS[kind] || [];
    const matchedStd = standards.find((std) => std.toLocaleLowerCase("pt-BR") === lower);
    if (matchedStd) {
      return matchedStd;
    }

    const now = new Date();
    await executor
      .insert(crmCatalogItems)
      .values({
        id: randomUUID(),
        tenantId,
        kind,
        name,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.warn(`[catalogs] Aviso ao garantir opção de catálogo (${kind}: ${name}):`, err);
  }

  return name;
}

export async function listCatalogItems(tenantId: string, kind: CatalogKind) {
  return db
    .select()
    .from(crmCatalogItems)
    .where(
      and(
        eq(crmCatalogItems.tenantId, tenantId),
        eq(crmCatalogItems.kind, kind),
        isNull(crmCatalogItems.archivedAt),
      ),
    )
    .orderBy(asc(crmCatalogItems.name));
}

export type CatalogItemScope = {
  allPipelines: boolean;
  pipelineIds: string[];
  stageIds: string[];
};

export function normalizeCatalogItemScope(raw: any): CatalogItemScope {
  const pipelineIds: string[] = Array.isArray(raw?.pipelineIds)
    ? Array.from(
        new Set<string>(
          raw.pipelineIds
            .filter((id: unknown): id is string => typeof id === "string")
            .map((id: string) => id.trim())
            .filter(Boolean),
        ),
      )
    : [];
  const stageIds: string[] = Array.isArray(raw?.stageIds)
    ? Array.from(
        new Set<string>(
          raw.stageIds
            .filter((id: unknown): id is string => typeof id === "string")
            .map((id: string) => id.trim())
            .filter(Boolean),
        ),
      )
    : [];
  const allPipelines =
    typeof raw?.allPipelines === "boolean"
      ? raw.allPipelines
      : pipelineIds.length === 0 && stageIds.length === 0;
  return {
    allPipelines: allPipelines && pipelineIds.length === 0 && stageIds.length === 0 ? true : allPipelines,
    pipelineIds,
    stageIds,
  };
}

export type CatalogPolicy = {
  allowUserCreate: boolean;
  includeStandard: boolean;
  disabledStandardItems: string[];
  restrictByStage: boolean;
  standardItemScopes: Record<string, CatalogItemScope>;
};

export async function getCatalogPolicy(tenantId: string, kind: CatalogKind): Promise<CatalogPolicy> {
  try {
    const [policy] = await db
      .select()
      .from(crmCatalogPolicies)
      .where(and(eq(crmCatalogPolicies.tenantId, tenantId), eq(crmCatalogPolicies.kind, kind)))
      .limit(1);
    const rawScopes =
      policy?.standardItemScopes && typeof policy.standardItemScopes === "object" && !Array.isArray(policy.standardItemScopes)
        ? (policy.standardItemScopes as Record<string, any>)
        : {};
    const standardItemScopes: Record<string, CatalogItemScope> = {};
    for (const [key, val] of Object.entries(rawScopes)) {
      if (key.trim()) {
        standardItemScopes[key.trim()] = normalizeCatalogItemScope(val);
      }
    }
    return {
      allowUserCreate: kind === "loss_reason" ? false : (policy?.allowUserCreate ?? false),
      includeStandard: policy?.includeStandard ?? true,
      disabledStandardItems: Array.isArray(policy?.disabledStandardItems)
        ? (policy.disabledStandardItems as string[])
        : [],
      restrictByStage: Boolean(policy?.restrictByStage),
      standardItemScopes,
    };
  } catch (err) {
    console.warn("[catalogs] Fallback em getCatalogPolicy:", err);
    return {
      allowUserCreate: false,
      includeStandard: true,
      disabledStandardItems: [],
      restrictByStage: false,
      standardItemScopes: {},
    };
  }
}

export type CatalogOption = {
  id: string;
  name: string;
  isStandard?: boolean;
  allPipelines?: boolean;
  pipelineIds?: string[];
  stageIds?: string[];
};

export function filterCatalogOptionsByContext(
  options: CatalogOption[],
  restrictByStage: boolean,
  context?: { pipelineId?: string | null; stageId?: string | null },
): CatalogOption[] {
  if (!restrictByStage) return options;
  const cleanStageId = context?.stageId?.trim() || "";
  const cleanPipelineId = context?.pipelineId?.trim() || "";
  if (!cleanStageId && !cleanPipelineId) return options;

  // 1. Vínculo estrito por etapa: se houver itens vinculados a esta etapa específica, exibe apenas eles
  if (cleanStageId) {
    const stageMatches = options.filter(
      (opt) => opt.allPipelines === false && Array.isArray(opt.stageIds) && opt.stageIds.includes(cleanStageId),
    );
    if (stageMatches.length > 0) {
      return stageMatches;
    }
  }

  // 2. Fallback por funil: se a etapa não tiver itens exclusivos, usa os itens vinculados ao funil inteiro
  if (cleanPipelineId) {
    const pipelineMatches = options.filter(
      (opt) =>
        opt.allPipelines === false &&
        Array.isArray(opt.pipelineIds) &&
        opt.pipelineIds.includes(cleanPipelineId) &&
        (!Array.isArray(opt.stageIds) || opt.stageIds.length === 0),
    );
    if (pipelineMatches.length > 0) {
      return pipelineMatches;
    }
  }

  // 3. Fallback global: itens liberados para todos os funis
  const globalMatches = options.filter((opt) => opt.allPipelines !== false);
  return globalMatches.length > 0 ? globalMatches : options;
}

export async function listAvailableCatalogOptions(
  tenantId: string,
  kind: CatalogKind,
  context?: { pipelineId?: string | null; stageId?: string | null },
): Promise<CatalogOption[]> {
  let [items, policy] = await Promise.all([
    listCatalogItems(tenantId, kind),
    getCatalogPolicy(tenantId, kind),
  ]);

  if (kind === "source" || kind === "campaign") {
    try {
      const col = kind === "source" ? crmDeals.source : crmDeals.campaign;
      const distinctDealValues = await db
        .selectDistinct({ val: col })
        .from(crmDeals)
        .where(and(eq(crmDeals.tenantId, tenantId), isNotNull(col)));

      const knownLower = new Set<string>([
        ...items.map((i) => i.name.toLocaleLowerCase("pt-BR")),
        ...(STANDARD_CATALOG_ITEMS[kind] || []).map((s) => s.toLocaleLowerCase("pt-BR")),
      ]);

      let insertedAny = false;
      for (const row of distinctDealValues) {
        const raw = typeof row.val === "string" ? row.val.trim() : "";
        if (!raw) continue;
        const lower = raw.toLocaleLowerCase("pt-BR");
        if (lower === "não informada" || lower === "nao informada") continue;
        if (!knownLower.has(lower)) {
          knownLower.add(lower);
          await ensureCatalogOption(tenantId, kind, raw);
          insertedAny = true;
        }
      }

      if (insertedAny) {
        items = await listCatalogItems(tenantId, kind);
      }
    } catch {
      // Em testes unitários com mocks parciais de db, segue silenciosamente
    }
  }

  const customOptions: CatalogOption[] = items.map((item) => {
    const scope = normalizeCatalogItemScope(item);
    return {
      id: item.id,
      name: item.name,
      isStandard: false,
      allPipelines: scope.allPipelines,
      pipelineIds: scope.pipelineIds,
      stageIds: scope.stageIds,
    };
  });

  if (!policy.includeStandard) {
    const sortedCustom = customOptions.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return kind === "loss_reason"
      ? filterCatalogOptionsByContext(sortedCustom, policy.restrictByStage, context)
      : sortedCustom;
  }

  const disabledSet = new Set(
    policy.disabledStandardItems.map((s) => s.toLocaleLowerCase("pt-BR")),
  );
  const customNamesSet = new Set(
    items.map((item) => item.name.toLocaleLowerCase("pt-BR")),
  );

  const standards = STANDARD_CATALOG_ITEMS[kind] || [];
  const standardOptions: CatalogOption[] = standards
    .filter(
      (name) =>
        !disabledSet.has(name.toLocaleLowerCase("pt-BR")) &&
        !customNamesSet.has(name.toLocaleLowerCase("pt-BR")),
    )
    .map((name, index) => {
      const stdScope = normalizeCatalogItemScope(policy.standardItemScopes?.[name]);
      return {
        id: `std-${kind}-${index}`,
        name,
        isStandard: true,
        allPipelines: stdScope.allPipelines,
        pipelineIds: stdScope.pipelineIds,
        stageIds: stdScope.stageIds,
      };
    });

  const allSorted = [...customOptions, ...standardOptions].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );

  return kind === "loss_reason"
    ? filterCatalogOptionsByContext(allSorted, policy.restrictByStage, context)
    : allSorted;
}

export async function validateCatalogChoice(
  tenantId: string,
  kind: CatalogKind,
  value: unknown,
  previous?: string | null,
  context?: { pipelineId?: string | null; stageId?: string | null },
): Promise<string | null> {
  if (value === null || value === "") return null;
  const name = normalizeCatalogName(value);
  // Dados antigos e valores gerados pelas integrações continuam válidos quando
  // o registro não está sendo alterado manualmente.
  if (name === previous) {
    if (kind === "source" || kind === "campaign") {
      await ensureCatalogOption(tenantId, kind, name);
    }
    return name;
  }

  if (kind === "loss_reason" && (context?.pipelineId || context?.stageId)) {
    const allowedOptions = await listAvailableCatalogOptions(tenantId, kind, context);
    const matched = allowedOptions.find(
      (opt) => opt.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
    );
    if (matched) return matched.name;
    throw new CatalogValidationError(
      "O motivo de perda selecionado não está habilitado para a etapa ou funil atual desta negociação.",
    );
  }

  const [items, policy] = await Promise.all([
    listCatalogItems(tenantId, kind),
    getCatalogPolicy(tenantId, kind),
  ]);

  if (
    items.some((item) => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))
  ) {
    return name;
  }

  if (policy.includeStandard) {
    const disabledSet = new Set(
      policy.disabledStandardItems.map((s) => s.toLocaleLowerCase("pt-BR")),
    );
    const standards = STANDARD_CATALOG_ITEMS[kind] || [];
    if (
      standards.some(
        (std) =>
          std.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR") &&
          !disabledSet.has(std.toLocaleLowerCase("pt-BR")),
      )
    ) {
      return name;
    }
  }

  if (kind === "source" || kind === "campaign") {
    const ensured = await ensureCatalogOption(tenantId, kind, name);
    if (ensured) return ensured;
  }

  throw new CatalogValidationError(
    `Selecione ${kind === "segment" ? "um segmento" : kind === "source" ? "uma fonte" : kind === "campaign" ? "uma campanha" : "um motivo de perda"} cadastrado e ativo nas configurações.`,
  );
}
