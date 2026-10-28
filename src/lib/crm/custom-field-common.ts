/** Browser-safe field metadata; importing an editor must never import a database client. */
export type CustomFieldEntity = "deal" | "company" | "contact" | "product";
export type CustomFieldType = "text" | "date" | "single" | "multiple" | "number" | "url";
export function normalizePipelineId(id?: string | null): string {
  if (!id) return "";
  return id.toLowerCase().trim().replace(/-2-0$/, "").replace(/^pipe-(tecfag-)?/, "");
}
