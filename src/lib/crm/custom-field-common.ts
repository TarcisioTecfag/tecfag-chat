/** Browser-safe field metadata; importing an editor must never import a database client. */
export type CustomFieldEntity = "deal" | "company" | "contact" | "product";
export type CustomFieldType = "text" | "date" | "single" | "multiple" | "number" | "url";
export type CustomFieldStatusFilter = "active" | "inactive" | "all";

export function normalizePipelineId(id?: string | null): string {
  if (!id) return "";
  return id.toLowerCase().trim().replace(/-2-0$/, "").replace(/^pipe-(tecfag-)?/, "");
}

export function isCustomFieldInactive(field?: { archivedAt?: unknown } | null): boolean {
  return Boolean(field?.archivedAt);
}

export function isCustomFieldStatusFilter(value: unknown): value is CustomFieldStatusFilter {
  return value === "active" || value === "inactive" || value === "all";
}
