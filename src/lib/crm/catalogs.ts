import { and, eq, isNull, asc } from "drizzle-orm";
import { db } from "../../db";
import { crmCatalogItems, crmCatalogPolicies } from "../../db/schema";

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

export type CatalogPolicy = {
  allowUserCreate: boolean;
  includeStandard: boolean;
  disabledStandardItems: string[];
};

export async function getCatalogPolicy(tenantId: string, kind: CatalogKind): Promise<CatalogPolicy> {
  try {
    const [policy] = await db
      .select()
      .from(crmCatalogPolicies)
      .where(and(eq(crmCatalogPolicies.tenantId, tenantId), eq(crmCatalogPolicies.kind, kind)))
      .limit(1);
    return {
      allowUserCreate: kind === "loss_reason" ? false : (policy?.allowUserCreate ?? false),
      includeStandard: policy?.includeStandard ?? true,
      disabledStandardItems: Array.isArray(policy?.disabledStandardItems)
        ? (policy.disabledStandardItems as string[])
        : [],
    };
  } catch (err) {
    console.warn("[catalogs] Fallback em getCatalogPolicy:", err);
    return {
      allowUserCreate: false,
      includeStandard: true,
      disabledStandardItems: [],
    };
  }
}

export type CatalogOption = {
  id: string;
  name: string;
  isStandard?: boolean;
};

export async function listAvailableCatalogOptions(
  tenantId: string,
  kind: CatalogKind,
): Promise<CatalogOption[]> {
  const [items, policy] = await Promise.all([
    listCatalogItems(tenantId, kind),
    getCatalogPolicy(tenantId, kind),
  ]);

  const customOptions: CatalogOption[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    isStandard: false,
  }));

  if (!policy.includeStandard) {
    return customOptions;
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
    .map((name, index) => ({
      id: `std-${kind}-${index}`,
      name,
      isStandard: true,
    }));

  return [...customOptions, ...standardOptions].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
}

export async function validateCatalogChoice(
  tenantId: string,
  kind: CatalogKind,
  value: unknown,
  previous?: string | null,
): Promise<string | null> {
  if (value === null || value === "") return null;
  const name = normalizeCatalogName(value);
  // Dados antigos e valores gerados pelas integrações continuam válidos quando
  // o registro não está sendo alterado manualmente.
  if (name === previous) return name;

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

  throw new CatalogValidationError(
    `Selecione ${kind === "segment" ? "um segmento" : kind === "source" ? "uma fonte" : kind === "campaign" ? "uma campanha" : "um motivo de perda"} cadastrado e ativo nas configurações.`,
  );
}
