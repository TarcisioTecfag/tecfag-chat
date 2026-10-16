import { CrmError } from "../crm/crm-service";
import { readRdFields, writeRd } from "./api-service";
import { RD_ACTIVITY_FIELDS } from "./activity-events";

export async function prepareRdActivityFields(
  tenantId: string,
  version: string,
  fetchImpl?: typeof fetch,
) {
  const list = async () => {
    const raw = await readRdFields(tenantId, fetchImpl);
    const rows = Array.isArray(raw) ? raw : (raw as { fields?: unknown })?.fields;
    if (!Array.isArray(rows))
      throw new CrmError("Não foi possível conferir os campos do RD.", "RD_FIELDS_INVALID", 502);
    if (
      rows.some(
        (row) =>
          !row || typeof row.api_identifier !== "string" || typeof row.data_type !== "string",
      )
    )
      throw new CrmError("Não foi possível conferir os campos do RD.", "RD_FIELDS_INVALID", 502);
    return rows as { api_identifier: string; data_type: string }[];
  };
  let fields = await list();
  for (const field of RD_ACTIVITY_FIELDS) {
    if (!fields.some((f) => f.api_identifier === field.api_identifier)) {
      try {
        const created = (await writeRd(
          tenantId,
          "/platform/contacts/fields",
          {
            api_identifier: field.api_identifier,
            data_type: "STRING",
            presentation_type: field.presentation_type,
            name: { "pt-BR": field.label },
            label: { "pt-BR": field.label },
          },
          version,
          fetchImpl,
        )) as { api_identifier?: unknown; data_type?: unknown } | null;
        // The documented 201 response already confirms the field. Avoid another GET
        // after every creation, especially on accounts close to their API limit.
        if (
          created?.api_identifier === field.api_identifier &&
          typeof created.data_type === "string"
        )
          fields.push({ api_identifier: field.api_identifier, data_type: created.data_type });
        else fields = await list();
      } catch (error) {
        const known = error instanceof CrmError ? error : null;
        if (known?.code === "RD_CONNECTION_CHANGED") throw known;
        // Only reconcile possible duplicate/ambiguous writes. A denied or rate-limited
        // request must not cause another API call or be mislabeled as a permissions error.
        if (!known || [400, 409, 422].includes(known.statusCode) || known.statusCode >= 500) {
          const reconciled = await list();
          if (reconciled.some((f) => f.api_identifier === field.api_identifier))
            fields = reconciled;
          else throw setupError(field.api_identifier, known);
        } else throw setupError(field.api_identifier, known);
      }
      if (!fields.some((f) => f.api_identifier === field.api_identifier))
        throw setupError(field.api_identifier, null);
    }
    if (fields.find((f) => f.api_identifier === field.api_identifier)?.data_type !== "STRING")
      throw new CrmError(
        `O campo ${field.label} no RD precisa ser do tipo texto.`,
        "RD_FIELD_TYPE_MISMATCH",
        409,
      );
  }
}

function setupError(identifier: string, error: CrmError | null) {
  if (error?.code === "RD_CONNECTION_CHANGED") return error;
  const status = error?.statusCode || 502;
  const upstreamStatus = error?.code.match(/^RD_HTTP_(\d{3})$/)?.[1] || status;
  const validation = (error as (CrmError & { rdFieldValidation?: string }) | null)
    ?.rdFieldValidation;
  const advice =
    status === 429
      ? "O limite de consultas do RD foi atingido. Aguarde antes de salvar novamente."
      : status === 401 || status === 403
        ? "Reconecte o aplicativo com permissão para criar campos personalizados."
        : status === 400 || status === 422
          ? `O RD recusou a definição do campo personalizado.${validation ? ` Validação: ${validation}.` : ""}`
          : "Não foi possível confirmar a criação no RD. Tente salvar novamente; os campos já criados serão reaproveitados.";
  return new CrmError(
    `Falha ao preparar ${identifier}. ${advice} (HTTP ${upstreamStatus})`,
    "RD_FIELD_SETUP_FAILED",
    status,
  );
}
