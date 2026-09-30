import { and, eq, isNull, asc } from "drizzle-orm";
import { db } from "../../db";
import { crmCatalogItems, crmCatalogPolicies } from "../../db/schema";

export const catalogKinds = ["segment", "source", "campaign", "loss_reason"] as const;
export type CatalogKind = (typeof catalogKinds)[number];

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

export async function getCatalogPolicy(tenantId: string, kind: CatalogKind) {
  if (kind === "loss_reason") return false;
  const [policy] = await db
    .select()
    .from(crmCatalogPolicies)
    .where(and(eq(crmCatalogPolicies.tenantId, tenantId), eq(crmCatalogPolicies.kind, kind)))
    .limit(1);
  return policy?.allowUserCreate ?? false;
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
  const items = await listCatalogItems(tenantId, kind);
  if (
    items.some((item) => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))
  )
    return name;
  throw new CatalogValidationError(
    `Selecione ${kind === "segment" ? "um segmento" : kind === "source" ? "uma fonte" : kind === "campaign" ? "uma campanha" : "um motivo de perda"} cadastrado nas configurações.`,
  );
}
